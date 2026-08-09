#!/usr/bin/env node
// Roda os scrapers das companhias habilitadas para um conjunto de pares de
// datas dentro das janelas configuradas em src/config.js e grava os
// resultados em data/history.json.
//
// Uso:
//   node scripts/run-scrape.js                  -> todas as cias, janelas completas
//   node scripts/run-scrape.js --quick          -> so o par de datas padrao
//   node scripts/run-scrape.js --airline=latam  -> so uma companhia
//   node scripts/run-scrape.js --debug          -> salva screenshot/html em debug/
//   node scripts/run-scrape.js --delay=2000     -> pausa (ms) entre consultas

const cfg = require('../src/config');
const { appendEntry } = require('../src/history');
const { scrapeAirline } = require('../src/scrapers/base');
const { getAirline, getEnabledAirlines } = require('../src/scrapers');
const { eachDateInRange } = require('./date-utils');

function parseArgs(argv) {
  const args = { debug: false, quick: false, delay: 3000, airline: null };
  for (const a of argv) {
    if (a === '--debug') args.debug = true;
    else if (a === '--quick') args.quick = true;
    else if (a.startsWith('--delay=')) args.delay = parseInt(a.split('=')[1], 10);
    else if (a.startsWith('--airline=')) args.airline = a.split('=')[1];
  }
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

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
      `${airlines.length} companhia(s): ${airlines.map((a) => a.name).join(', ')} | ` +
      `${pairs.length} par(es) de datas | ${airlines.length * pairs.length} consulta(s)\n`
  );

  // Estatisticas por companhia, para o resumo final distinguir "uma cia
  // quebrou" de "tudo quebrou".
  const stats = new Map(airlines.map((a) => [a.id, { ok: 0, failed: 0, name: a.name }]));

  // Se as primeiras consultas de uma companhia falham todas pelo mesmo
  // motivo estrutural (bloqueio, rede, formulario sumido), as outras vao
  // falhar igual: abortar poupa tempo e evita martelar um site que ja
  // recusou o acesso.
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
          'O scraper dessa(s) companhia(s) provavelmente precisa de ajuste (veja debug/).'
      );
    }
  }
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exitCode = 1;
});
