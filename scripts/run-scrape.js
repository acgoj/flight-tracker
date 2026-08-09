#!/usr/bin/env node
// Roda o scraper da Azul para um conjunto de pares de datas dentro das
// janelas configuradas em src/config.js e grava os resultados em
// data/history.json.
//
// Uso:
//   node scripts/run-scrape.js                 -> varre as janelas de ida/volta
//   node scripts/run-scrape.js --quick          -> so testa o par padrao (defaultPair)
//   node scripts/run-scrape.js --debug          -> salva screenshot/html em debug/
//   node scripts/run-scrape.js --delay=2000     -> pausa (ms) entre requisicoes (padrao 3000)

const cfg = require('../src/config');
const { appendEntry } = require('../src/history');
const { scrapeAzulFare } = require('../src/scrapers/azul');
const { eachDateInRange } = require('./date-utils');

function parseArgs(argv) {
  const args = { debug: false, quick: false, delay: 3000 };
  for (const a of argv) {
    if (a === '--debug') args.debug = true;
    else if (a === '--quick') args.quick = true;
    else if (a.startsWith('--delay=')) args.delay = parseInt(a.split('=')[1], 10);
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

  // Varia a data de ida mantendo a volta padrao, e vice-versa - assim
  // descobrimos o melhor dia para ir e o melhor dia para voltar sem
  // precisar rodar a matriz completa (ida x volta), que seria muito lenta.
  for (const departDate of eachDateInRange(cfg.departureWindow.start, cfg.departureWindow.end)) {
    addPair(departDate, cfg.defaultPair.returnDate);
  }
  for (const returnDate of eachDateInRange(cfg.returnWindow.start, cfg.returnWindow.end)) {
    addPair(cfg.defaultPair.departDate, returnDate);
  }
  return pairs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pairs = buildPairs(cfg, args.quick);
  console.log(`Consultando ${pairs.length} par(es) de datas para ${cfg.route.origin}-${cfg.route.destination}...`);

  let ok = 0;
  let failed = 0;
  for (const [i, pair] of pairs.entries()) {
    process.stdout.write(`[${i + 1}/${pairs.length}] ${pair.departDate} -> ${pair.returnDate}: `);
    try {
      const result = await scrapeAzulFare(cfg, pair.departDate, pair.returnDate, { debug: args.debug });
      appendEntry(cfg, {
        scrapedAt: new Date().toISOString(),
        departDate: pair.departDate,
        returnDate: pair.returnDate,
        origin: cfg.route.origin,
        destination: cfg.route.destination,
        cashTotal: result.lowestCash,
        currency: 'BRL',
        pointsTotal: result.lowestPoints,
        pointsTax: result.lowestPointsTax ?? null,
        source: 'azul-scraper',
      });
      console.log(
        `R$ ${result.lowestCash ?? 'N/D'} | ${result.lowestPoints ?? 'N/D'} pontos` +
          (result.usedFallback ? ' (via formulario)' : ' (via URL direta)')
      );
      ok += 1;
    } catch (e) {
      console.log(`FALHOU (${e.message})`);
      failed += 1;
    }
    if (i < pairs.length - 1) await sleep(args.delay);
  }

  console.log(`\nConcluido: ${ok} sucesso(s), ${failed} falha(s).`);
  if (ok === 0 && failed > 0) {
    console.error(
      '\nNenhuma consulta funcionou. O site pode ter mudado de layout ou estar bloqueando ' +
        'o acesso automatizado. Rode com --debug e --quick e confira os arquivos em debug/, ' +
        'ou use `npm run add-price` para registrar precos manualmente enquanto isso.'
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error('Erro inesperado:', e);
  process.exitCode = 1;
});
