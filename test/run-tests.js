#!/usr/bin/env node
// Testes de sanidade (sem dependencias externas). Nao testam o scraper
// contra o site real (impossivel neste ambiente) - cobrem o parser contra
// uma fixture de texto, a logica de analise e a geracao do dashboard.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { parseSearchResultsText, extractCashValues, extractPointsValues, parseBrNumber } = require('../src/scrapers/azul-parser');
const { analyze, isGoodDeal, impliedPointValuePer1000 } = require('../src/analyze');
const { render } = require('../scripts/render-dashboard');
const cfg = require('../src/config');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
    passed += 1;
  } catch (e) {
    console.error(`FAIL - ${name}`);
    console.error(e);
    process.exitCode = 1;
  }
}

test('parseBrNumber converte formato brasileiro', () => {
  assert.strictEqual(parseBrNumber('1.234,56'), 1234.56);
  assert.strictEqual(parseBrNumber('843,21'), 843.21);
});

test('extractCashValues encontra as tarifas, ignorando linhas de taxa', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/sample-results-text.txt'), 'utf8');
  const values = extractCashValues(text);
  assert.deepStrictEqual(values, [843.21, 1102.0, 799.0]);
});

test('extractPointsValues encontra pontos, incluindo formato "mil"', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/sample-results-text.txt'), 'utf8');
  const values = extractPointsValues(text);
  assert.deepStrictEqual(values, [38500, 45200, 36500]);
});

test('parseSearchResultsText retorna o menor preco em R$ e em pontos', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/sample-results-text.txt'), 'utf8');
  const result = parseSearchResultsText(text);
  assert.strictEqual(result.lowestCash, 799.0);
  assert.strictEqual(result.lowestPoints, 36500);
});

test('impliedPointValuePer1000 calcula o valor do ponto', () => {
  const entry = { cashTotal: 843.21, pointsTotal: 38500, pointsTax: 89.9 };
  const value = impliedPointValuePer1000(entry);
  // (843.21 - 89.90) / 38500 * 1000 ~= 19.57
  assert.ok(Math.abs(value - 19.57) < 0.1, `esperava ~19.57, recebi ${value}`);
});

const sampleEntries = [
  { scrapedAt: '2026-08-01T10:00:00Z', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 1000, pointsTotal: 42000, pointsTax: 89.9 },
  { scrapedAt: '2026-08-03T10:00:00Z', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 950, pointsTotal: 40000, pointsTax: 89.9 },
  { scrapedAt: '2026-08-05T10:00:00Z', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 1100, pointsTotal: 45000, pointsTax: 89.9 },
  { scrapedAt: '2026-08-06T10:00:00Z', departDate: '2026-12-22', returnDate: '2027-01-05', cashTotal: 700, pointsTotal: 30000, pointsTax: 89.9 },
];

test('analyze calcula menor preco em dinheiro e em pontos', () => {
  const result = analyze(cfg, sampleEntries);
  assert.strictEqual(result.lowestCash.cashTotal, 700);
  assert.strictEqual(result.lowestPoints.pointsTotal, 30000);
  assert.strictEqual(result.totalSamples, 4);
  assert.strictEqual(result.pairSummaries.length, 2);
});

test('isGoodDeal identifica preco bem abaixo da media do par', () => {
  const cheapEntry = sampleEntries[3]; // 700, par diferente, sem media propria -> usa media geral
  assert.strictEqual(isGoodDeal(cfg, cheapEntry, sampleEntries), true);
  const normalEntry = sampleEntries[0];
  assert.strictEqual(isGoodDeal(cfg, normalEntry, sampleEntries), false);
});

test('render gera HTML valido com os dados de exemplo', () => {
  const analysis = analyze(cfg, sampleEntries);
  const html = render({ cfg, entries: sampleEntries, analysis, goodDeals: new Set(['2026-12-22_2027-01-05']), generatedAt: new Date().toISOString() });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Recife'));
  assert.ok(html.includes('Curitiba'));
  assert.ok(html.includes('bom preço'));
});

test('render lida com historico vazio sem quebrar', () => {
  const analysis = analyze(cfg, []);
  const html = render({ cfg, entries: [], analysis, goodDeals: new Set(), generatedAt: new Date().toISOString() });
  assert.ok(html.includes('sem dados'));
});

console.log(`\n${passed} teste(s) passaram.`);
