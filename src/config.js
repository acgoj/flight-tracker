// Configuracao da rota monitorada, das janelas de datas e das companhias.
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
  // (modo --quick) e como base ao varrer cada janela: o scraper fixa uma
  // ponta e varia a outra, em vez de rodar a matriz completa ida x volta.
  defaultPair: {
    departDate: '2026-12-20',
    returnDate: '2027-01-05',
  },

  passengers: {
    adults: 1,
  },

  // Companhias monitoradas. Desabilite (enabled: false) as que nao
  // interessam - cada uma habilitada multiplica o tempo de execucao.
  //
  // pointsPurchaseCostPer1000: quanto custa comprar 1000 pontos/milhas do
  // programa hoje, usado como referencia para decidir se compensa resgatar
  // com pontos ou pagar em dinheiro.
  //
  // ATENCAO: os valores abaixo sao PLACEHOLDERS aproximados - o preco de
  // compra de pontos muda o tempo todo (e cai bastante em promocao).
  // Atualize com o valor real antes de confiar na comparacao.
  airlines: {
    azul: {
      enabled: true,
      loyaltyProgram: 'TudoAzul',
      pointsPurchaseCostPer1000: 34.99, // PLACEHOLDER
    },
    gol: {
      enabled: true,
      loyaltyProgram: 'Smiles',
      pointsPurchaseCostPer1000: 31.9, // PLACEHOLDER
    },
    latam: {
      enabled: true,
      loyaltyProgram: 'LATAM Pass',
      pointsPurchaseCostPer1000: 28.9, // PLACEHOLDER
    },
  },

  // Um preco em dinheiro e considerado "bom negocio" quando estiver esta
  // fracao (ou mais) abaixo da media historica registrada para o mesmo par
  // de datas (ou da media geral, se ainda nao houver historico suficiente).
  goodDealThreshold: 0.15, // 15% abaixo da media

  // Historico minimo de amostras antes de calcular "bom negocio" por media.
  minSamplesForAverage: 3,

  paths: {
    historyFile: 'data/history.json',
    dashboardOutput: 'docs/index.html',
  },
};
