#!/usr/bin/env node
// Registra manualmente um preco encontrado (rede de seguranca caso o
// scraper automatico pare de funcionar por mudanca no site).
//
// Uso:
//   node scripts/add-price.js --depart 2026-12-20 --return 2027-01-05 \
//     --cash 850.30 --points 38000 --points-tax 89.90 [--notes "achei no app"]
//
// --cash e --points-tax sao valores em R$ (use ponto como separador decimal).
// Pelo menos um de --cash ou --points deve ser informado.

const cfg = require('../src/config');
const { appendEntry } = require('../src/history');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const value = argv[i + 1];
    args[name] = value;
    i += 1;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const departDate = args.depart || cfg.defaultPair.departDate;
  const returnDate = args.return || cfg.defaultPair.returnDate;
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
    departDate,
    returnDate,
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
