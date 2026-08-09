// LATAM / LATAM Pass.
//
// A LATAM separa a busca em dinheiro da busca em pontos pelo parametro
// `redemption` na URL (false = dinheiro, true = resgate com pontos), entao
// fazemos duas passadas. As datas vao em formato ISO completo com hora
// (meio-dia UTC evita virar o dia por fuso).
//
// NAO VALIDADO CONTRA O SITE REAL (ver README).

function buildUrl(cfg, departDate, returnDate, redemption) {
  const params = new URLSearchParams({
    origin: cfg.route.origin,
    destination: cfg.route.destination,
    outbound: `${departDate}T12:00:00.000Z`,
    inbound: `${returnDate}T12:00:00.000Z`,
    adt: String(cfg.passengers.adults),
    chd: '0',
    inf: '0',
    trip: 'RT',
    cabin: 'Economy',
    redemption: String(redemption),
    sort: 'PRICE',
  });
  return `https://www.latamairlines.com/br/pt/oferta-voos?${params}`;
}

module.exports = {
  id: 'latam',
  name: 'LATAM',
  loyaltyProgram: 'LATAM Pass',
  homeUrl: 'https://www.latamairlines.com/br/pt',
  resultsWaitMs: 10000,

  buildCashUrl: (cfg, departDate, returnDate) => buildUrl(cfg, departDate, returnDate, false),
  buildPointsUrl: (cfg, departDate, returnDate) => buildUrl(cfg, departDate, returnDate, true),

  formSelectors: {
    originInput: ['#txtInputOrigin_field', 'input[placeholder*="Origem" i]', '[data-testid*="origin" i] input'],
    destinationInput: ['#txtInputDestination_field', 'input[placeholder*="Destino" i]', '[data-testid*="destination" i] input'],
    departDateInput: ['input[placeholder*="Ida" i]', '[data-testid*="departure" i] input'],
    returnDateInput: ['input[placeholder*="Volta" i]', '[data-testid*="return" i] input'],
    searchButton: ['button:has-text("Buscar")', 'button:has-text("Pesquisar")', 'button[type="submit"]'],
  },
};
