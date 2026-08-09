#!/usr/bin/env node
// Le data/history.json, calcula a analise e grava o dashboard estatico em
// docs/index.html (pronto para publicar via GitHub Pages).

const fs = require('fs');
const path = require('path');
const cfg = require('../src/config');
const { loadHistory } = require('../src/history');
const { analyze, isGoodDeal, pairKey } = require('../src/analyze');
const { render } = require('./render-dashboard');

function main() {
  const entries = loadHistory(cfg);
  const analysis = analyze(cfg, entries);

  const goodDeals = new Set();
  for (const e of entries) {
    if (isGoodDeal(cfg, e, entries)) goodDeals.add(pairKey(e));
  }

  const html = render({ cfg, entries, analysis, goodDeals, generatedAt: new Date().toISOString() });

  const outPath = path.resolve(process.cwd(), cfg.paths.dashboardOutput);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');
  console.log(`Dashboard gerado em ${cfg.paths.dashboardOutput} (${entries.length} amostras).`);
}

main();
