// Infraestrutura compartilhada por todos os scrapers de companhia.
//
// Cada companhia (src/scrapers/azul.js, gol.js, latam.js) e um modulo
// pequeno e declarativo que descreve COMO chegar na pagina de resultados;
// todo o resto - abrir navegador, tentar URL direta, cair para o
// preenchimento de formulario, coletar o texto, salvar debug - mora aqui.
// Assim, quando o site de uma companhia muda, o conserto fica isolado
// naquele modulo.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { parseSearchResultsText } = require('./fare-parser');

// User agent de navegador comum: varios sites de companhia devolvem uma
// pagina vazia (ou bloqueiam) para o UA padrao do Playwright.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function fmtDateBR(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function saveDebugArtifacts(page, label) {
  const dir = path.resolve(process.cwd(), 'debug');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${label}-${Date.now()}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    fs.writeFileSync(`${base}.html`, await page.content(), 'utf8');
  } catch (e) {
    // Captura de debug nunca deve derrubar o scraper.
    console.error(`  (falha ao salvar debug: ${e.message})`);
  }
  return base;
}

async function fillFirstMatch(page, selectors, value) {
  for (const sel of selectors || []) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      await locator.fill(value);
      return sel;
    }
  }
  return null;
}

async function clickFirstMatch(page, selectors) {
  for (const sel of selectors || []) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      await locator.click();
      return sel;
    }
  }
  return null;
}

// Considera que a pagina "carregou resultados" se o texto tem sinal de
// preco (R$) ou de fidelidade (pontos/milhas). Evita gravar lixo quando o
// site redireciona para a home ou mostra tela de erro.
function looksLikeResults(text) {
  return /R\$|pontos?|milhas?/i.test(text || '');
}

// Falha de rede (sem conexao, conexao resetada, DNS, bloqueio de proxy).
// Distinguir isso de "carregou mas nao achei preco" e o que faz a
// diferenca entre "conserte o scraper" e "conserte a rede/o bloqueio".
//
// Aparece de duas formas, e as duas precisam ser cobertas: o Playwright
// LANCA a partir do goto (net::ERR_CONNECTION_RESET), e quando nao lanca a
// pagina de erro do navegador fica renderizada no lugar do site.
function looksLikeNetworkError(text) {
  return /ERR_[A-Z_]+|This site can.t be reached|não é possível acessar esse site|site pode estar temporariamente indisponível/i.test(
    text || ''
  );
}

// Devolve sempre { text, networkError } - nunca lanca. text vem null
// quando a pagina carregou mas nao parece uma tela de resultados.
async function collectFromUrl(page, url, waitMs) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    return { text: null, networkError: looksLikeNetworkError(e.message) };
  }
  await page.waitForTimeout(waitMs);
  const text = await page.innerText('body').catch(() => '');
  if (looksLikeNetworkError(text)) return { text: null, networkError: true };
  return { text: looksLikeResults(text) ? text : null, networkError: false };
}

// Plano B: abre a home e preenche o formulario de busca manualmente.
// Mesmo contrato de collectFromUrl: sempre { text, networkError }.
async function collectFromForm(page, airline, cfg, departDate, returnDate, waitMs) {
  const sel = airline.formSelectors;
  if (!sel) return { text: null, networkError: false };

  try {
    await page.goto(airline.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    return { text: null, networkError: looksLikeNetworkError(e.message) };
  }
  await page.waitForTimeout(2000);

  await fillFirstMatch(page, sel.originInput, cfg.route.origin);
  await page.waitForTimeout(500);
  await fillFirstMatch(page, sel.destinationInput, cfg.route.destination);
  await page.waitForTimeout(500);
  await fillFirstMatch(page, sel.departDateInput, fmtDateBR(departDate));
  await fillFirstMatch(page, sel.returnDateInput, fmtDateBR(returnDate));
  await clickFirstMatch(page, sel.searchButton);

  await page.waitForTimeout(waitMs);
  const text = await page.innerText('body').catch(() => '');
  if (looksLikeNetworkError(text)) return { text: null, networkError: true };
  return { text: looksLikeResults(text) ? text : null, networkError: false };
}

// Roda um scraper de companhia para um par de datas.
//
// Companhias que mostram dinheiro e pontos na mesma tela (Azul) definem so
// buildCashUrl. Companhias que separam as duas buscas (LATAM com
// redemption=true, GOL/Smiles em outro dominio) definem tambem
// buildPointsUrl, e ai fazemos duas passadas.
async function scrapeAirline(cfg, airline, departDate, returnDate, { debug = false } = {}) {
  const waitMs = airline.resultsWaitMs || 6000;
  // CHROMIUM_PATH permite apontar um Chromium ja instalado na maquina,
  // util quando o navegador do ambiente nao bate com a versao do
  // Playwright do projeto. Vazio = comportamento padrao do Playwright.
  const launchOptions = { headless: true };
  if (process.env.CHROMIUM_PATH) launchOptions.executablePath = process.env.CHROMIUM_PATH;
  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({ locale: 'pt-BR', userAgent: USER_AGENT });
  const page = await context.newPage();

  try {
    const label = `${airline.id}-${departDate}_${returnDate}`;

    // Passada 1: preco em dinheiro.
    const direct = await collectFromUrl(page, airline.buildCashUrl(cfg, departDate, returnDate), waitMs);
    let cashText = direct.text;
    let networkError = direct.networkError;
    let usedFallback = false;

    if (!cashText) {
      usedFallback = true;
      const viaForm = await collectFromForm(page, airline, cfg, departDate, returnDate, waitMs);
      cashText = viaForm.text;
      // So culpa a rede se AMBAS as tentativas falharam por rede - se o
      // formulario carregou, o site esta no ar e o problema e outro.
      networkError = networkError && viaForm.networkError;
    }
    if (debug) await saveDebugArtifacts(page, `${label}-dinheiro`);

    // Passada 2: preco em pontos/milhas, quando a companhia usa uma busca
    // separada. Falha aqui nao invalida o preco em dinheiro ja coletado.
    let pointsText = cashText;
    if (airline.buildPointsUrl) {
      const r = await collectFromUrl(page, airline.buildPointsUrl(cfg, departDate, returnDate), waitMs);
      pointsText = r.text;
      if (debug) await saveDebugArtifacts(page, `${label}-pontos`);
    }

    const cashParsed = cashText ? parseSearchResultsText(cashText) : {};
    const pointsParsed = pointsText ? parseSearchResultsText(pointsText) : {};

    const result = {
      lowestCash: cashParsed.lowestCash ?? null,
      lowestPoints: pointsParsed.lowestPoints ?? null,
      lowestPointsTax: pointsParsed.lowestPointsTax ?? null,
      usedFallback,
    };

    if (result.lowestCash == null && result.lowestPoints == null) {
      await saveDebugArtifacts(page, `${label}-VAZIO`);
      // Erro de rede e um problema totalmente diferente de "o site mudou":
      // dizer qual dos dois foi economiza uma investigacao inteira.
      throw new Error(
        networkError
          ? 'a pagina nao carregou (conexao recusada/resetada) - problema de rede ou bloqueio do site, nao do parser'
          : `nenhum preco encontrado (usedFallback=${usedFallback}); veja debug/ para o HTML capturado`
      );
    }
    return result;
  } finally {
    await browser.close();
  }
}

module.exports = {
  scrapeAirline,
  saveDebugArtifacts,
  fmtDateBR,
  looksLikeResults,
  looksLikeNetworkError,
  USER_AGENT,
};
