// Fonte de precos em dinheiro via Google Voos.
//
// Os sites das companhias (Azul, GOL, LATAM) bloqueiam IP de datacenter
// (Akamai Access Denied), o que impede o Playwright no GitHub Actions.
// O Google Voos devolve HTML com as tarifas ja renderizadas (SSR), sem
// login, e aceita busca por querystring. Cada resultado traz o itinerario
// IATA (AD=Azul, G3=GOL, LA=LATAM) perto do preco em reais.

const fs = require('fs');
const path = require('path');
const { USER_AGENT, looksLikeBotBlock, looksLikeNetworkError, classifyPage } = require('./base');

const IATA_TO_AIRLINE = {
  AD: 'azul',
  G3: 'gol',
  LA: 'latam',
  JJ: 'latam',
};

const PRICE_LABEL_RE = /aria-label="(\d+(?:[.,]\d+)?) Reais brasileiros"/gi;
const ITINERARY_RE = /itinerary=([^"'&\s]+)/gi;
const IATA_CODE_RE = /-(AD|G3|LA|JJ)-\d+/g;

function buildUrl(cfg, departDate, returnDate) {
  const q = `Flights to ${cfg.route.destination} from ${cfg.route.origin} on ${departDate} through ${returnDate}`;
  const params = new URLSearchParams({
    hl: 'pt-BR',
    gl: 'BR',
    curr: 'BRL',
    q,
  });
  return `https://www.google.com/travel/flights?${params}`;
}

function uniqueAirlineIdsFromItinerary(itinerary) {
  const decoded = decodeURIComponent(itinerary);
  const ids = new Set();
  IATA_CODE_RE.lastIndex = 0;
  let m;
  while ((m = IATA_CODE_RE.exec(decoded)) !== null) {
    const airlineId = IATA_TO_AIRLINE[m[1]];
    if (airlineId) ids.add(airlineId);
  }
  return [...ids];
}

function lastItineraryIn(text) {
  let last = null;
  ITINERARY_RE.lastIndex = 0;
  let m;
  while ((m = ITINERARY_RE.exec(text)) !== null) last = m[1];
  return last;
}

// Associa cada preco ao codigo IATA do itinerario mais proximo (janela
// anterior ao aria-label, que e o layout atual do Google Voos). Itinerarios
// com mais de uma cia monitorada sao ignorados: nao da para atribuir o
// preco a uma so companhia.
function parseGoogleFlightsHtml(html) {
  const lowestByAirline = {};
  PRICE_LABEL_RE.lastIndex = 0;
  let m;
  while ((m = PRICE_LABEL_RE.exec(html)) !== null) {
    const raw = m[1].replace(/\./g, '').replace(',', '.');
    const price = parseFloat(raw);
    if (Number.isNaN(price) || price <= 0) continue;

    const windowStart = Math.max(0, m.index - 6000);
    // So o texto ANTES do preco: no HTML do Google Voos o itinerario vem no
    // card, acima do aria-label. Olhar para frente pega o card seguinte.
    const around = html.slice(windowStart, m.index);
    const itinerary = lastItineraryIn(around);
    if (!itinerary) continue;

    const ids = uniqueAirlineIdsFromItinerary(itinerary);
    if (ids.length !== 1) continue;
    const id = ids[0];
    if (lowestByAirline[id] == null || price < lowestByAirline[id]) {
      lowestByAirline[id] = price;
    }
  }
  return lowestByAirline;
}

function looksLikeConsent(html) {
  return /Before you continue to Google|Antes de continuar no Google|consent\.google/i.test(html || '');
}

async function fetchHtml(url) {
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(25000),
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
  } catch (e) {
    const err = new Error(`ERRO DE REDE ao abrir Google Voos: ${e.message}`);
    err.kind = looksLikeNetworkError(e.message) ? 'erro-de-rede' : 'falha-ao-abrir';
    throw err;
  }
  const html = await res.text();
  if (!res.ok) {
    const err = new Error(`Google Voos HTTP ${res.status}`);
    err.kind = res.status === 403 || res.status === 429 ? 'bloqueio-anti-bot' : 'falha-ao-abrir';
    err.html = html;
    throw err;
  }
  return html;
}

function saveDebugHtml(label, html) {
  const dir = path.resolve(process.cwd(), 'debug');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}-${Date.now()}.html`);
  try {
    fs.writeFileSync(file, html, 'utf8');
  } catch (e) {
    console.error(`  (falha ao salvar debug: ${e.message})`);
  }
  return file;
}

function fail(kind, message, html, extras = {}) {
  if (html) saveDebugHtml(`google-${kind}`, html);
  const err = new Error(message);
  err.kind = kind;
  Object.assign(err, extras);
  throw err;
}

// Uma consulta ao Google Voos devolve o menor preco em dinheiro de cada
// companhia monitorada para o par de datas. Nao ha pontos/milhas aqui.
async function scrapeGoogleFlights(cfg, departDate, returnDate, { debug = false } = {}) {
  const url = buildUrl(cfg, departDate, returnDate);
  const html = await fetchHtml(url);

  if (debug) saveDebugHtml(`google-${departDate}_${returnDate}`, html);

  // Precos primeiro: o HTML do Google cita recaptcha em scripts mesmo quando
  // a busca funcionou. So trata como bloqueio se nao houver tarifa alguma.
  const lowestByAirline = parseGoogleFlightsHtml(html);
  if (Object.keys(lowestByAirline).length) return lowestByAirline;

  if (looksLikeConsent(html) || looksLikeBotBlock(html)) {
    fail(
      'bloqueio-anti-bot',
      'BLOQUEIO ANTI-BOT: o Google Voos recusou ou pediu consentimento/captcha. ' +
        'Tente de novo mais tarde ou registre o preco com `npm run add-price`.',
      html
    );
  }

  const kind = classifyPage(html);
  if (kind === 'erro-de-rede' || kind === 'vazia') {
    fail(kind, `Google Voos: pagina ${kind}.`, html);
  }

  fail(
    'carregou-sem-precos',
    'A PAGINA DO GOOGLE VOOS CARREGOU mas nao tinha tarifas atribuiveis ' +
      '(layout mudou, busca sem voos, ou itinerario misto).',
    html
  );
}

module.exports = {
  IATA_TO_AIRLINE,
  buildUrl,
  parseGoogleFlightsHtml,
  scrapeGoogleFlights,
  looksLikeConsent,
};
