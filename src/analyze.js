// Logica de analise de precos: menor preco em dinheiro, menor preco em
// pontos, valor implicito do ponto e deteccao de "bom negocio".

function average(numbers) {
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function pairKey(entry) {
  return `${entry.departDate}_${entry.returnDate}`;
}

// Valor implicito do ponto (em R$ por 1000 pontos) para uma entrada:
// quanto dinheiro voce "economiza" por ponto gasto, comparando a opcao em
// pontos (pontos + taxas) com a opcao equivalente em dinheiro na mesma
// consulta. So faz sentido quando as duas opcoes existem na mesma entrada.
function impliedPointValuePer1000(entry) {
  if (entry.cashTotal == null || entry.pointsTotal == null) return null;
  const cashAvoided = entry.cashTotal - (entry.pointsTax || 0);
  if (cashAvoided <= 0 || entry.pointsTotal <= 0) return null;
  return (cashAvoided / entry.pointsTotal) * 1000;
}

function analyze(cfg, entries) {
  const withCash = entries.filter((e) => e.cashTotal != null);
  const withPoints = entries.filter((e) => e.pointsTotal != null);

  const lowestCash = withCash.reduce(
    (best, e) => (!best || e.cashTotal < best.cashTotal ? e : best),
    null
  );
  const lowestPoints = withPoints.reduce(
    (best, e) => (!best || e.pointsTotal < best.pointsTotal ? e : best),
    null
  );

  const avgCash = average(withCash.map((e) => e.cashTotal));
  const avgPoints = average(withPoints.map((e) => e.pointsTotal));

  const pointValues = entries
    .map(impliedPointValuePer1000)
    .filter((v) => v != null);
  const avgImpliedPointValue = average(pointValues);

  // Agrupa por par de datas para ver a melhor combinacao ja vista.
  const byPair = new Map();
  for (const e of entries) {
    const key = pairKey(e);
    if (!byPair.has(key)) {
      byPair.set(key, { departDate: e.departDate, returnDate: e.returnDate, entries: [] });
    }
    byPair.get(key).entries.push(e);
  }
  const pairSummaries = Array.from(byPair.values()).map((p) => {
    const cash = p.entries.filter((e) => e.cashTotal != null);
    const points = p.entries.filter((e) => e.pointsTotal != null);
    return {
      departDate: p.departDate,
      returnDate: p.returnDate,
      lowestCash: cash.length ? Math.min(...cash.map((e) => e.cashTotal)) : null,
      lowestPoints: points.length ? Math.min(...points.map((e) => e.pointsTotal)) : null,
      samples: p.entries.length,
    };
  });
  pairSummaries.sort((a, b) => {
    if (a.lowestCash == null) return 1;
    if (b.lowestCash == null) return -1;
    return a.lowestCash - b.lowestCash;
  });

  return {
    totalSamples: entries.length,
    lowestCash,
    lowestPoints,
    avgCash,
    avgPoints,
    avgImpliedPointValue,
    pairSummaries,
  };
}

// Diz se um preco em dinheiro e um "bom negocio" comparado a media
// historica para o mesmo par de datas (ou a media geral, como fallback).
function isGoodDeal(cfg, entry, entries) {
  if (entry.cashTotal == null) return false;
  const samePair = entries.filter(
    (e) => e.departDate === entry.departDate && e.returnDate === entry.returnDate && e.cashTotal != null
  );
  const pool = samePair.length >= cfg.minSamplesForAverage ? samePair : entries.filter((e) => e.cashTotal != null);
  if (pool.length < cfg.minSamplesForAverage) return false;
  const avg = average(pool.map((e) => e.cashTotal));
  if (avg == null) return false;
  return entry.cashTotal <= avg * (1 - cfg.goodDealThreshold);
}

module.exports = { analyze, isGoodDeal, impliedPointValuePer1000, average, pairKey };
