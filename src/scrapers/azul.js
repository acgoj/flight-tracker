// Scraper "melhor esforco" para a busca publica de voos da Azul, que
// mostra preco em dinheiro (R$) e em pontos TudoAzul na mesma tela, sem
// login. Ver aviso importante em azul-parser.js sobre por que a extracao
// e feita por texto em vez de seletores CSS.
//
// NAO FOI POSSIVEL VALIDAR ESTE SCRAPER CONTRA O SITE REAL no ambiente em
// que foi escrito (bloqueio de rede). Rode com `--debug` na primeira vez
// (via `npm run scrape -- --debug`) para salvar screenshot + HTML em
// debug/ e confirmar que a extracao esta pegando os precos certos; ajuste
// os seletores abaixo (bloco SELECTORS) se o formulario de busca tiver
// mudado.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { parseSearchResultsText } = require('./azul-parser');

const BASE_URL = 'https://www.voeazul.com.br/br/pt/home';

// Ajuste aqui se o formulario de busca do site mudar.
const SELECTORS = {
  originInput: ['input[placeholder*="De onde" i]', '[data-testid*="origin" i] input', '#originAirport'],
  destinationInput: ['input[placeholder*="Para onde" i]', '[data-testid*="destination" i] input', '#destinationAirport'],
  departDateInput: ['input[placeholder*="Ida" i]', '[data-testid*="departure" i] input'],
  returnDateInput: ['input[placeholder*="Volta" i]', '[data-testid*="return" i] input'],
  searchButton: ['button:has-text("Buscar")', 'button:has-text("Pesquisar")', 'button[type="submit"]'],
};

function fmtDateBR(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

async function clickFirstMatch(page, selectors, options = {}) {
  for (const sel of selectors) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      await locator.click(options);
      return sel;
    }
  }
  return null;
}

async function fillFirstMatch(page, selectors, value) {
  for (const sel of selectors) {
    const locator = page.locator(sel).first();
    if (await locator.count()) {
      await locator.fill(value);
      return sel;
    }
  }
  return null;
}

async function saveDebugArtifacts(page, label) {
  const dir = path.resolve(process.cwd(), 'debug');
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `${label}-${Date.now()}`);
  try {
    await page.screenshot({ path: `${base}.png`, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(`${base}.html`, html, 'utf8');
  } catch (e) {
    // Nao deixa a captura de debug derrubar o scraper.
    console.error('Falha ao salvar artefatos de debug:', e.message);
  }
  return base;
}

async function tryDirectUrl(page, cfg, departDate, returnDate) {
  // Deep-link "melhor esforco": alguns sites de busca de voos aceitam a
  // rota/data direto na URL. Se o formato estiver errado, o site
  // normalmente redireciona para a home ou mostra o formulario vazio -
  // nesse caso caimos no fallback de preencher o formulario manualmente.
  const url =
    `${BASE_URL}/select-flight?originAirport=${cfg.route.origin}` +
    `&destinationAirport=${cfg.route.destination}` +
    `&departureDate=${departDate}&returnDate=${returnDate}` +
    `&adults=${cfg.passengers.adults}&tripType=roundTrip&currency=BRL`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);
  const text = await page.innerText('body').catch(() => '');
  return /pontos|R\$/i.test(text) ? text : null;
}

async function tryFormFill(page, cfg, departDate, returnDate) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2000);

  await fillFirstMatch(page, SELECTORS.originInput, cfg.route.origin);
  await page.waitForTimeout(500);
  await fillFirstMatch(page, SELECTORS.destinationInput, cfg.route.destination);
  await page.waitForTimeout(500);
  await fillFirstMatch(page, SELECTORS.departDateInput, fmtDateBR(departDate));
  await fillFirstMatch(page, SELECTORS.returnDateInput, fmtDateBR(returnDate));
  await clickFirstMatch(page, SELECTORS.searchButton);

  await page.waitForTimeout(6000);
  return page.innerText('body').catch(() => '');
}

// Busca o par de datas (departDate, returnDate no formato YYYY-MM-DD) e
// retorna { lowestCash, lowestPoints, raw }. Lanca erro se nada puder ser
// extraido (chamador decide se trata como falha silenciosa ou nao).
async function scrapeAzulFare(cfg, departDate, returnDate, { debug = false } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'pt-BR' });
  try {
    let text = await tryDirectUrl(page, cfg, departDate, returnDate).catch(() => null);
    let usedFallback = false;
    if (!text) {
      usedFallback = true;
      text = await tryFormFill(page, cfg, departDate, returnDate);
    }

    if (debug) {
      await saveDebugArtifacts(page, `azul-${departDate}_${returnDate}`);
    }

    const parsed = parseSearchResultsText(text || '');
    if (parsed.lowestCash == null && parsed.lowestPoints == null) {
      await saveDebugArtifacts(page, `azul-EMPTY-${departDate}_${returnDate}`);
      throw new Error(
        `Nenhum preco encontrado para ${departDate} -> ${returnDate} (usedFallback=${usedFallback}). ` +
          'Veja debug/ para investigar o HTML capturado.'
      );
    }
    return { ...parsed, usedFallback };
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeAzulFare, fmtDateBR };
