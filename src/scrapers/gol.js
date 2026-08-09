// GOL / Smiles.
//
// A GOL e a companhia mais incerta das tres neste projeto, por dois
// motivos:
//
// 1. A busca em dinheiro vive no dominio de compra (b2c.voegol.com.br),
//    cujo formato de URL muda com frequencia - o plano B (preencher o
//    formulario na home) provavelmente sera o caminho usado na pratica.
// 2. As milhas ficam no Smiles, que e um site separado e normalmente exige
//    LOGIN para mostrar as tabelas boas (clube, promocoes). Sem login, a
//    busca publica pode devolver nada ou so uma parte das opcoes. Se o
//    valor em milhas vier sempre vazio, e esperado - registre manualmente
//    com `npm run add-price -- --airline gol --points ...`.
//
// NAO VALIDADO CONTRA O SITE REAL (ver README).

module.exports = {
  id: 'gol',
  name: 'GOL',
  loyaltyProgram: 'Smiles',
  homeUrl: 'https://www.voegol.com.br/',
  resultsWaitMs: 10000,

  buildCashUrl(cfg, departDate, returnDate) {
    const params = new URLSearchParams({
      origem: cfg.route.origin,
      destino: cfg.route.destination,
      dataIda: departDate,
      dataVolta: returnDate,
      adultos: String(cfg.passengers.adults),
      criancas: '0',
      bebes: '0',
      tipoViagem: 'RT',
    });
    return `https://b2c.voegol.com.br/compra/busca-voos?${params}`;
  },

  buildPointsUrl(cfg, departDate, returnDate) {
    const params = new URLSearchParams({
      originAirport: cfg.route.origin,
      destinationAirport: cfg.route.destination,
      departureDate: departDate,
      returnDate: returnDate,
      adults: String(cfg.passengers.adults),
      children: '0',
      infants: '0',
      tripType: '1',
      cabin: 'ALL',
    });
    return `https://www.smiles.com.br/emissao-com-milhas?${params}`;
  },

  formSelectors: {
    originInput: ['input[placeholder*="Origem" i]', 'input[aria-label*="Origem" i]', '#origin'],
    destinationInput: ['input[placeholder*="Destino" i]', 'input[aria-label*="Destino" i]', '#destination'],
    departDateInput: ['input[placeholder*="Ida" i]', '[data-testid*="departure" i] input'],
    returnDateInput: ['input[placeholder*="Volta" i]', '[data-testid*="return" i] input'],
    searchButton: ['button:has-text("Buscar")', 'button:has-text("Comprar")', 'button[type="submit"]'],
  },
};
