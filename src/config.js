// Configuracao da rota monitorada e das janelas de datas.
// Edite este arquivo para mudar rota, datas ou parametros de analise.

module.exports = {
  route: {
    origin: 'REC', // Recife
    destination: 'CWB', // Curitiba
    originName: 'Recife',
    destinationName: 'Curitiba',
  },

  // Janela de datas de ida (fim de dezembro) e volta (inicio de janeiro).
  // Formato: 'YYYY-MM-DD'. O scraper testa candidatos dentro dessas janelas.
  departureWindow: {
    start: '2026-12-18',
    end: '2026-12-31',
  },
  returnWindow: {
    start: '2027-01-02',
    end: '2027-01-11',
  },

  // Datas "padrao" usadas quando so queremos checar um par especifico
  // (ex.: para uma consulta manual rapida ou como fallback).
  defaultPair: {
    departDate: '2026-12-20',
    returnDate: '2027-01-05',
  },

  passengers: {
    adults: 1,
  },

  // Programa de milhas/pontos monitorado.
  loyaltyProgram: 'TudoAzul',

  // Quanto custa comprar pontos TudoAzul hoje (R$ por 1000 pontos), usado como
  // referencia para decidir se vale mais a pena pagar em dinheiro ou em pontos.
  // Ajuste esse valor quando houver promocao de compra de pontos.
  pointsPurchaseCostPer1000: 34.99,

  // Um preco em dinheiro e considerado "bom negocio" quando estiver esta
  // fracao (ou mais) abaixo da media historica registrada para o mesmo par
  // de datas (ou da media geral, se ainda nao houver historico suficiente).
  goodDealThreshold: 0.15, // 15% abaixo da media

  // Historico minimo de pontos antes de calcular "bom negocio" por media.
  minSamplesForAverage: 3,

  paths: {
    historyFile: 'data/history.json',
    dashboardOutput: 'docs/index.html',
  },
};
