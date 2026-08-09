#!/usr/bin/env node
// Registra manualmente um preco encontrado (rede de seguranca caso o
// scraper automatico de alguma companhia pare de funcionar).
//
// Uso:
//   node scripts/add-price.js --airline azul --depart 2026-12-20 \
//     --return 2027-01-05 --cash 850.30 --points 38000 --points-tax 89.90
//
// --cash e --points-tax sao valores em R$ (use ponto como separador
// decimal). Pelo menos um de --cash ou --points deve ser informado.

const cfg = require('../src/config');
const { appendEntry } = require('../src/history');
const { getAirline, AIRLINES } = require('../src/scrapers');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.airline) {
    console.error(`Informe --airline (disponiveis: ${Object.keys(AIRLINES).join(', ')}).`);
    process.exitCode = 1;
    return;
  }

  let airline;
  try {
    airline = getAirline(args.airline);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }

  const cashTotal = args.cash != null ? parseFloat(args.cash) : null;
  const pointsTotal = args.points != null ? parseInt(args.points, 10) : null;
  const pointsTax = args['points-tax'] != null ? parseFloat(args['points-tax']) : null;

  if (cashTotal == null && pointsTotal == null) {
    console.error('Informe pelo menos --cash ou --points.');
    process.exitCode = 1;
    return;
  }

  const entry = {
    scrapedAt: new Date().toISOString(),
    airline: airline.id,
    airlineName: airline.name,
    loyaltyProgram: airline.loyaltyProgram,
    departDate: args.depart || cfg.defaultPair.departDate,
    returnDate: args.return || cfg.defaultPair.returnDate,
    origin: cfg.route.origin,
    destination: cfg.route.destination,
    cashTotal,
    currency: 'BRL',
    pointsTotal,
    pointsTax,
    source: 'manual',
    notes: args.notes || null,
  };

  appendEntry(cfg, entry);
  console.log('Registrado:', JSON.stringify(entry, null, 2));
}

main();
