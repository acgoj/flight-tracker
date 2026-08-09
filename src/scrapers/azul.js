// Azul / TudoAzul.
//
// A busca publica da Azul mostra o preco em dinheiro e em pontos TudoAzul
// na mesma tela, sem login - por isso nao ha buildPointsUrl separado.
//
// NAO VALIDADO CONTRA O SITE REAL (ver README). Ajuste a URL/seletores
// abaixo depois de conferir os artefatos em debug/.

module.exports = {
  id: 'azul',
  name: 'Azul',
  loyaltyProgram: 'TudoAzul',
  homeUrl: 'https://www.voeazul.com.br/br/pt/home',
  resultsWaitMs: 8000,

  buildCashUrl(cfg, departDate, returnDate) {
    const params = new URLSearchParams({
      originAirport: cfg.route.origin,
      destinationAirport: cfg.route.destination,
      departureDate: departDate,
      returnDate: returnDate,
      adults: String(cfg.passengers.adults),
      tripType: 'roundTrip',
      currency: 'BRL',
    });
    return `https://www.voeazul.com.br/br/pt/home/select-flight?${params}`;
  },

  formSelectors: {
    originInput: ['input[placeholder*="De onde" i]', '[data-testid*="origin" i] input', '#originAirport'],
    destinationInput: ['input[placeholder*="Para onde" i]', '[data-testid*="destination" i] input', '#destinationAirport'],
    departDateInput: ['input[placeholder*="Ida" i]', '[data-testid*="departure" i] input'],
    returnDateInput: ['input[placeholder*="Volta" i]', '[data-testid*="return" i] input'],
    searchButton: ['button:has-text("Buscar")', 'button:has-text("Pesquisar")', 'button[type="submit"]'],
  },
};
