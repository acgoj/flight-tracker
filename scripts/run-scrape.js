#!/usr/bin/env node
// Consulta precos para um conjunto de pares de datas (src/config.js) e
// grava os resultados em data/history.json.
//
// Uso:
//   node scripts/run-scrape.js                       -> Google Voos, janelas completas
//   node scripts/run-scrape.js --quick               -> so o par de datas padrao
//   node scripts/run-scrape.js --airline=latam       -> so uma companhia
//   node scripts/run-scrape.js --source=airlines     -> Playwright nos sites das cias
//   node scripts/run-scrape.js --source=all          -> Google + sites das cias
//   node scripts/run-scrape.js --debug               -> salva html em debug/
//   node scripts/run-scrape.js --delay=2000          -> pausa (ms) entre consultas
//
// Padrao: --source=google. Os sites das cias bloqueiam IP de datacenter
// (GitHub Actions); o Google Voos e a fonte que realmente devolve tarifa
// em dinheiro. Pontos/milhas continuam vindo das cias (--source=airlines)
// ou de `npm run add-price`.

const cfg = require('../src/config');
const { appendEntry } = require('../src/history');
const { scrapeAirline } = require('../src/scrapers/base');
const { scrapeGoogleFlights } = require('../src/scrapers/google-flights');
const { getAirline, getEnabledAirlines } = require('../src/scrapers');
const { eachDateInRange } = require('./date-utils');

const SOURCES = new Set(['google', 'airlines', 'all']);

function parseArgs(argv) {
  const args = { debug: false, quick: false, delay: null, airline: null, source: 'google' };
  for (const a of argv) {
    if (a === '--debug') args.debug = true;
    else if (a === '--quick') args.quick = true;
    else if (a.startsWith('--delay=')) args.delay = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--airline=')) args.airline = a.split('=')[1];
    else if (a.startsWith('--source=')) args.source = a.split('=')[1];
  }
  if (!SOURCES.has(args.source)) {
    throw new Error(`Fonte desconhecida: "${args.source}". Disponiveis: ${[...SOURCES].join(', ')}`);
  }
  if (args.delay == null) args.delay = args.source === 'google' ? 1200 : 3000;
  return args;
}

function buildPairs(cfg, quick) {
  if (quick) {
    return [{ departDate: cfg.defaultPair.departDate, returnDate: cfg.defaultPair.returnDate }];
  }
  const pairs = [];
  const seen = new Set();
  const addPair = (departDate, returnDate) => {
    const key = `${departDate}_${returnDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ departDate, returnDate });
  };

  // Fixa a volta e varia a ida, depois fixa a ida e varia a volta - assim
  // descobrimos o melhor dia de cada ponta sem rodar a matriz completa.
  for (const departDate of eachDateInRange(cfg.departureWindow.start, cfg.departureWindow.end)) {
    addPair(departDate, cfg.defaultPair.returnDate);
  }
  for (const returnDate of eachDateInRange(cfg.returnWindow.start, cfg.returnWindow.end)) {
    addPair(cfg.defaultPair.departDate, returnDate);
  }
  return pairs;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fmtValue(v, suffix) {
  return v == null ? 'N/D' : `${v}${suffix}`;
}

function recordCash(cfg, airline, pair, cashTotal, source) {
  appendEntry(cfg, {
    scrapedAt: new Date().toISOString(),
    airline: airline.id,
    airlineName: airline.name,
    loyaltyProgram: airline.loyaltyProgram,
    departDate: pair.departDate,
    returnDate: pair.returnDate,
    origin: cfg.route.origin,
    destination: cfg.route.destination,
    cashTotal,
    currency: 'BRL',
    pointsTotal: null,
    pointsTax: null,
    source,
  });
}

function recordAirlineResult(cfg, airline, pair, result) {
  appendEntry(cfg, {
    scrapedAt: new Date().toISOString(),
    airline: airline.id,
    airlineName: airline.name,
    loyaltyProgram: airline.loyaltyProgram,
    departDate: pair.departDate,
    returnDate: pair.returnDate,
    origin: cfg.route.origin,
    destination: cfg.route.destination,
    cashTotal: result.lowestCash,
    currency: 'BRL',
    pointsTotal: result.lowestPoints,
    pointsTax: result.lowestPointsTax,
    source: `${airline.id}-scraper`,
  });
}

async function scrapeFromGoogle(cfg, airlines, pairs, args, stats) {
  console.log('== Google Voos (preco em dinheiro por companhia) ==');
  const FATAL_KINDS = new Set(['bloqueio-anti-bot', 'erro-de-rede']);
  const ABORT_AFTER = 3;
  let consecutiveFatal = 0;
  let lastFatalKind = null;

  for (const [i, pair] of pairs.entries()) {
    if (consecutiveFatal >= ABORT_AFTER) {
      const restantes = pairs.length - i;
      console.log(`  Abortando Google Voos: ${ABORT_AFTER} falhas seguidas por "${lastFatalKind}". ` +
        `${restantes} consulta(s) puladas.`);
      for (const airline of airlines) {
        stats.get(airline.id).failed += restantes;
        stats.get(airline.id).abortedBecause = lastFatalKind;
      }
      break;
    }
    process.stdout.write(`  [${i + 1}/${pairs.length}] ${pair.departDate} -> ${pair.returnDate}: `);
    try {
      const byAirline = await scrapeGoogleFlights(cfg, pair.departDate, pair.returnDate, {
        debug: args.debug,
      });
      const found = [];
      for (const airline of airlines) {
        const cash = byAirline[airline.id];
        if (cash == null) {
          stats.get(airline.id).failed += 1;
          continue;
        }
        recordCash(cfg, airline, pair, cash, 'google-flights');
        stats.get(airline.id).ok += 1;
        found.push(`${airline.name} ${fmtValue(cash, '')} R$`);
      }
      console.log(found.length ? found.join(' | ') : 'sem tarifas das cias monitoradas');
      consecutiveFatal = 0;
    } catch (e) {
      console.log(`FALHOU\n      ${e.message}`);
      for (const airline of airlines) stats.get(airline.id).failed += 1;
      if (FATAL_KINDS.has(e.kind)) {
        consecutiveFatal = e.kind === lastFatalKind ? consecutiveFatal + 1 : 1;
        lastFatalKind = e.kind;
      } else {
        consecutiveFatal = 0;
      }
    }
    if (i < pairs.length - 1) await sleep(args.delay);
  }
  console.log('');
}

async function scrapeFromAirlines(cfg, airlines, pairs, args, stats) {
  const FATAL_KINDS = new Set(['bloqueio-anti-bot', 'erro-de-rede', 'formulario-nao-encontrado']);
  const ABORT_AFTER = 3;

  for (const airline of airlines) {
    console.log(`== ${airline.name} (${airline.loyaltyProgram}) ==`);
    let consecutiveFatal = 0;
    let lastFatalKind = null;

    for (const [i, pair] of pairs.entries()) {
      if (consecutiveFatal >= ABORT_AFTER) {
        const restantes = pairs.length - i;
        console.log(`  Abortando ${airline.name}: ${ABORT_AFTER} falhas seguidas por "${lastFatalKind}". ` +
          `${restantes} consulta(s) puladas.`);
        stats.get(airline.id).failed += restantes;
        stats.get(airline.id).abortedBecause = lastFatalKind;
        break;
      }
      process.stdout.write(`  [${i + 1}/${pairs.length}] ${pair.departDate} -> ${pair.returnDate}: `);
      try {
        const result = await scrapeAirline(cfg, airline, pair.departDate, pair.returnDate, {
          debug: args.debug,
        });
        recordAirlineResult(cfg, airline, pair, result);
        console.log(
          `${fmtValue(result.lowestCash, '')} R$ | ${fmtValue(result.lowestPoints, ' pts')}` +
            (result.usedFallback ? ' (via formulario)' : '')
        );
        stats.get(airline.id).ok += 1;
        consecutiveFatal = 0;
      } catch (e) {
        console.log(`FALHOU\n      ${e.message}`);
        stats.get(airline.id).failed += 1;
        if (FATAL_KINDS.has(e.kind)) {
          consecutiveFatal = e.kind === lastFatalKind ? consecutiveFatal + 1 : 1;
          lastFatalKind = e.kind;
        } else {
          consecutiveFatal = 0;
        }
      }
      if (i < pairs.length - 1) await sleep(args.delay);
    }
    console.log('');
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }

  let airlines;
  try {
    airlines = args.airline ? [getAirline(args.airline)] : getEnabledAirlines(cfg);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }

  const pairs = buildPairs(cfg, args.quick);

  if (!airlines.length) {
    console.error('Nenhuma companhia habilitada em src/config.js -> airlines.');
    process.exitCode = 1;
    return;
  }

  console.log(
    `Rota ${cfg.route.origin}-${cfg.route.destination} | ` +
      `fonte=${args.source} | ` +
      `${airlines.length} companhia(s): ${airlines.map((a) => a.name).join(', ')} | ` +
      `${pairs.length} par(es) de datas\n`
  );

  const stats = new Map(airlines.map((a) => [a.id, { ok: 0, failed: 0, name: a.name }]));

  if (args.source === 'google' || args.source === 'all') {
    await scrapeFromGoogle(cfg, airlines, pairs, args, stats);
  }
  if (args.source === 'airlines' || args.source === 'all') {
    await scrapeFromAirlines(cfg, airlines, pairs, args, stats);
  }

  console.log('Resumo:');
  let totalOk = 0;
  for (const [, s] of stats) {
    const motivo = s.abortedBecause ? ` — abortada: ${s.abortedBecause}` : '';
    console.log(`  ${s.name}: ${s.ok} sucesso(s), ${s.failed} falha(s)${motivo}`);
    totalOk += s.ok;
  }

  if (totalOk === 0) {
    const motivos = [...new Set(Array.from(stats.values()).map((s) => s.abortedBecause).filter(Boolean))];
    console.error(
      '\nNenhuma consulta funcionou em nenhuma companhia.' +
        (motivos.length ? ` Causa predominante: ${motivos.join(', ')}.` : '') +
        '\nAs mensagens acima dizem se o problema foi bloqueio, rede ou layout. ' +
        'Enquanto isso, `npm run add-price` registra precos manualmente.'
    );
    process.exitCode = 1;
  } else {
    const broken = Array.from(stats.values()).filter((s) => s.ok === 0 && s.failed > 0);
    if (broken.length) {
      console.warn(
        `\nAtencao: nenhuma consulta funcionou em ${broken.map((s) => s.name).join(', ')}. ` +
          'Essa(s) companhia(s) pode(m) nao ter voo no Google Voos para essas datas, ' +
          'ou o scraper direto precisa de ajuste (veja debug/).'
      );
    }
  }
}

module.exports = { parseArgs, buildPairs };

if (require.main === module) {
  main().catch((e) => {
    console.error('Erro inesperado:', e);
    process.exitCode = 1;
  });
}
