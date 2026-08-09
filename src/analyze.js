// Logica de analise de precos: menor preco em dinheiro, menor preco em
// pontos, valor implicito do ponto, comparacao entre companhias e
// deteccao de "bom negocio".

function average(numbers) {
  if (numbers.length === 0) return null;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

function pairKey(entry) {
  return `${entry.departDate}_${entry.returnDate}`;
}

function minBy(entries, field) {
  return entries.reduce((best, e) => (!best || e[field] < best[field] ? e : best), null);
}

// Valor implicito do ponto (em R$ por 1000 pontos): quanto dinheiro voce
// "economiza" por ponto gasto, comparando a opcao em pontos (pontos +
// taxas) com a opcao em dinheiro da mesma consulta. So faz sentido quando
// as duas opcoes existem na mesma entrada.
function impliedPointValuePer1000(entry) {
  if (entry.cashTotal == null || entry.pointsTotal == null) return null;
  const cashAvoided = entry.cashTotal - (entry.pointsTax || 0);
  if (cashAvoided <= 0 || entry.pointsTotal <= 0) return null;
  return (cashAvoided / entry.pointsTotal) * 1000;
}

// Compara o valor que voce extrai do ponto com o custo de comprar esse
// ponto. Se o valor extraido for maior que o custo de compra, comprar
// pontos para resgatar sai mais barato que pagar a passagem em dinheiro.
function pointsVerdict(cfg, entry) {
  const value = impliedPointValuePer1000(entry);
  if (value == null) return null;
  const settings = cfg.airlines[entry.airline];
  const cost = settings && settings.pointsPurchaseCostPer1000;
  if (cost == null) return { value, cost: null, worthIt: null };
  return { value, cost, worthIt: value > cost };
}

function summarize(entries) {
  const withCash = entries.filter((e) => e.cashTotal != null);
  const withPoints = entries.filter((e) => e.pointsTotal != null);
  return {
    lowestCash: minBy(withCash, 'cashTotal'),
    lowestPoints: minBy(withPoints, 'pointsTotal'),
    avgCash: average(withCash.map((e) => e.cashTotal)),
    avgPoints: average(withPoints.map((e) => e.pointsTotal)),
    samples: entries.length,
  };
}

function analyze(cfg, entries) {
  const overall = summarize(entries);

  const pointValues = entries.map(impliedPointValuePer1000).filter((v) => v != null);

  // Quebra por companhia, para comparar lado a lado.
  const byAirline = new Map();
  for (const e of entries) {
    const id = e.airline || 'desconhecida';
    if (!byAirline.has(id)) byAirline.set(id, []);
    byAirline.get(id).push(e);
  }
  const airlineSummaries = Array.from(byAirline.entries())
    .map(([id, airlineEntries]) => {
      const s = summarize(airlineEntries);
      const values = airlineEntries.map(impliedPointValuePer1000).filter((v) => v != null);
      const settings = cfg.airlines[id] || {};
      return {
        airline: id,
        airlineName: airlineEntries[0].airlineName || id,
        loyaltyProgram: airlineEntries[0].loyaltyProgram || settings.loyaltyProgram || null,
        pointsPurchaseCostPer1000: settings.pointsPurchaseCostPer1000 ?? null,
        avgImpliedPointValue: average(values),
        ...s,
      };
    })
    .sort((a, b) => {
      if (a.lowestCash == null) return 1;
      if (b.lowestCash == null) return -1;
      return a.lowestCash.cashTotal - b.lowestCash.cashTotal;
    });

  // Quebra por par de datas, guardando qual companhia deu o melhor preco.
  const byPair = new Map();
  for (const e of entries) {
    const key = pairKey(e);
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(e);
  }
  const pairSummaries = Array.from(byPair.values())
    .map((pairEntries) => {
      const s = summarize(pairEntries);
      return {
        departDate: pairEntries[0].departDate,
        returnDate: pairEntries[0].returnDate,
        lowestCash: s.lowestCash ? s.lowestCash.cashTotal : null,
        lowestCashAirline: s.lowestCash ? s.lowestCash.airlineName || s.lowestCash.airline : null,
        lowestPoints: s.lowestPoints ? s.lowestPoints.pointsTotal : null,
        lowestPointsAirline: s.lowestPoints ? s.lowestPoints.airlineName || s.lowestPoints.airline : null,
        samples: pairEntries.length,
      };
    })
    .sort((a, b) => {
      if (a.lowestCash == null) return 1;
      if (b.lowestCash == null) return -1;
      return a.lowestCash - b.lowestCash;
    });

  return {
    totalSamples: entries.length,
    lowestCash: overall.lowestCash,
    lowestPoints: overall.lowestPoints,
    avgCash: overall.avgCash,
    avgPoints: overall.avgPoints,
    avgImpliedPointValue: average(pointValues),
    airlineSummaries,
    pairSummaries,
  };
}

// Um preco em dinheiro e "bom negocio" se estiver bem abaixo da media
// historica do mesmo par de datas NA MESMA COMPANHIA (companhias tem
// patamares de preco diferentes, entao misturar todas distorceria a
// media). Cai para a media da companhia, e depois para a media geral,
// quando nao ha amostras suficientes.
function isGoodDeal(cfg, entry, entries) {
  if (entry.cashTotal == null) return false;
  const withCash = entries.filter((e) => e.cashTotal != null);

  const samePairSameAirline = withCash.filter(
    (e) => e.airline === entry.airline && e.departDate === entry.departDate && e.returnDate === entry.returnDate
  );
  const sameAirline = withCash.filter((e) => e.airline === entry.airline);

  let pool;
  if (samePairSameAirline.length >= cfg.minSamplesForAverage) pool = samePairSameAirline;
  else if (sameAirline.length >= cfg.minSamplesForAverage) pool = sameAirline;
  else pool = withCash;

  if (pool.length < cfg.minSamplesForAverage) return false;
  const avg = average(pool.map((e) => e.cashTotal));
  if (avg == null) return false;
  return entry.cashTotal <= avg * (1 - cfg.goodDealThreshold);
}

module.exports = {
  analyze,
  isGoodDeal,
  impliedPointValuePer1000,
  pointsVerdict,
  average,
  pairKey,
};
