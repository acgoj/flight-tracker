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

// Tela de protecao anti-bot (Akamai, Incapsula, Cloudflare, PerimeterX).
// Companhias aereas usam isso pesado, e runners de CI saem de IP de
// datacenter - que e justamente o que essas protecoes bloqueiam. E um
// diagnostico completamente diferente de "o site mudou de layout": nao
// adianta mexer em seletor, o conteudo nunca chegou.
function looksLikeBotBlock(text) {
  return /Access Denied|Pardon Our Interruption|Request unsuccessful|Incapsula|unusual traffic|verifique que você não é um robô|Attention Required|Checking your browser|captcha|Reference #\d|Error 15\d\d/i.test(
    text || ''
  );
}

// O que fazer diante de cada diagnostico. Vai direto para o log, para que
// quem le a execucao saiba se o problema e do codigo, do site ou do IP.
const EXPLANATIONS = {
  'bloqueio-anti-bot':
    'BLOQUEIO ANTI-BOT: o site recusou o acesso automatizado (comum a partir de IP de datacenter, como os runners do GitHub Actions). ' +
    'Mexer em seletor nao resolve - rode local, ou registre o preco com `npm run add-price`.',
  'erro-de-rede': 'ERRO DE REDE: a pagina nao carregou (conexao recusada/resetada/DNS). Problema de rede ou bloqueio, nao do parser.',
  'falha-ao-abrir': 'FALHA AO ABRIR a pagina (timeout ou erro do navegador).',
  'carregou-sem-precos':
    'A PAGINA CARREGOU mas nao tinha nenhum preco: o deep-link pode estar errado (caiu na home), a busca nao retornou voos, ' +
    'ou os resultados demoram mais que o tempo de espera (resultsWaitMs).',
  'formulario-nao-encontrado':
    'FORMULARIO NAO ENCONTRADO: nenhum seletor de busca bateu. O layout do site provavelmente mudou - ajuste formSelectors deste modulo.',
  vazia: 'A PAGINA VEIO VAZIA (sem texto algum).',
  'sem-formulario': 'A URL direta nao trouxe resultados e este modulo nao define formSelectors como plano B.',
};

// Classifica o que a pagina realmente e, para que a mensagem de erro
// aponte a causa em vez de mandar o investigador procurar seletor a toa.
function classifyPage(text) {
  if (!text || !text.trim()) return 'vazia';
  if (looksLikeNetworkError(text)) return 'erro-de-rede';
  if (looksLikeBotBlock(text)) return 'bloqueio-anti-bot';
  if (looksLikeResults(text)) return 'resultados';
  return 'carregou-sem-precos';
}

// Resumo curto da pagina para ir no log: titulo + comeco do texto. Sem
// isso, descobrir o motivo da falha exige baixar o artefato de debug.
function pageSnippet(title, text) {
  const clean = (text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  return `titulo="${(title || '').slice(0, 60)}" texto="${clean}${clean.length === 160 ? '…' : ''}"`;
}

// Espera os precos aparecerem em vez de dormir um tempo fixo: sites de
// companhia sao SPAs que carregam os voos por XHR depois do
// domcontentloaded. Retorna assim que houver sinal de preco, ou desiste
// no timeout (e ai o texto que voltar ja serve para diagnosticar).
async function waitForPrices(page, timeoutMs) {
  const started = Date.now();
  let text = '';
  while (Date.now() - started < timeoutMs) {
    text = await page.innerText('body').catch(() => '');
    if (looksLikeResults(text) || looksLikeNetworkError(text) || looksLikeBotBlock(text)) return text;
    await page.waitForTimeout(1000);
  }
  return text;
}

// Devolve sempre { text, kind, snippet } - nunca lanca. text so vem
// preenchido quando a pagina parece de resultados; kind explica o resto.
async function collectFromUrl(page, url, waitMs) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    const kind = looksLikeNetworkError(e.message) ? 'erro-de-rede' : 'falha-ao-abrir';
    return { text: null, kind, snippet: e.message.split('\n')[0].slice(0, 120) };
  }
  const raw = await waitForPrices(page, waitMs);
  const kind = classifyPage(raw);
  const title = await page.title().catch(() => '');
  return {
    text: kind === 'resultados' ? raw : null,
    kind,
    snippet: pageSnippet(title, raw),
  };
}

// Plano B: abre a home e preenche o formulario de busca manualmente.
// Mesmo contrato de collectFromUrl: sempre { text, kind, snippet }.
async function collectFromForm(page, airline, cfg, departDate, returnDate, waitMs) {
  const sel = airline.formSelectors;
  if (!sel) return { text: null, kind: 'sem-formulario', snippet: '' };

  try {
    await page.goto(airline.homeUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  } catch (e) {
    const kind = looksLikeNetworkError(e.message) ? 'erro-de-rede' : 'falha-ao-abrir';
    return { text: null, kind, snippet: e.message.split('\n')[0].slice(0, 120) };
  }
  await page.waitForTimeout(2000);

  // Se a home ja e bloqueio/erro, nem adianta tentar preencher o
  // formulario - reporta a causa real em vez de "seletor nao encontrado".
  const homeText = await page.innerText('body').catch(() => '');
  const homeKind = classifyPage(homeText);
  if (homeKind === 'bloqueio-anti-bot' || homeKind === 'erro-de-rede') {
    const title = await page.title().catch(() => '');
    return { text: null, kind: homeKind, snippet: pageSnippet(title, homeText) };
  }

  const filled = {
    origem: await fillFirstMatch(page, sel.originInput, cfg.route.origin),
    destino: await fillFirstMatch(page, sel.destinationInput, cfg.route.destination),
  };
  await page.waitForTimeout(500);
  await fillFirstMatch(page, sel.departDateInput, fmtDateBR(departDate));
  await fillFirstMatch(page, sel.returnDateInput, fmtDateBR(returnDate));
  const clicked = await clickFirstMatch(page, sel.searchButton);

  // Nenhum seletor bateu = o formulario mudou. Diagnostico bem diferente
  // de "busquei e nao achei voo".
  if (!filled.origem && !filled.destino && !clicked) {
    const title = await page.title().catch(() => '');
    return {
      text: null,
      kind: 'formulario-nao-encontrado',
      snippet: pageSnippet(title, homeText),
    };
  }

  const raw = await waitForPrices(page, waitMs);
  const kind = classifyPage(raw);
  const title = await page.title().catch(() => '');
  return { text: kind === 'resultados' ? raw : null, kind, snippet: pageSnippet(title, raw) };
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
    let diagnosis = { kind: direct.kind, snippet: direct.snippet, via: 'url-direta' };
    let usedFallback = false;

    if (!cashText) {
      usedFallback = true;
      const viaForm = await collectFromForm(page, airline, cfg, departDate, returnDate, waitMs);
      cashText = viaForm.text;
      // O diagnostico da segunda tentativa manda: se o formulario carregou,
      // o site esta no ar e o problema nao e o que a primeira sugeriu.
      diagnosis = { kind: viaForm.kind, snippet: viaForm.snippet, via: 'formulario' };
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
      kind: diagnosis.kind,
    };

    if (result.lowestCash == null && result.lowestPoints == null) {
      await saveDebugArtifacts(page, `${label}-${diagnosis.kind}`);
      // A causa vai na propria mensagem: sem isso o log so diz "nao achei
      // preco" e a investigacao exige baixar o artefato de debug.
      const err = new Error(`${EXPLANATIONS[diagnosis.kind] || diagnosis.kind} [via ${diagnosis.via}] ${diagnosis.snippet}`);
      err.kind = diagnosis.kind;
      throw err;
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
  looksLikeBotBlock,
  classifyPage,
  EXPLANATIONS,
  USER_AGENT,
};
