#!/usr/bin/env node
// Testes de sanidade (sem dependencias externas). Nao testam os scrapers
// contra os sites reais (impossivel neste ambiente) - cobrem o parser
// contra fixtures de texto das tres companhias, a logica de analise e a
// geracao do dashboard.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const {
  parseSearchResultsText,
  extractCashValues,
  extractPointsValues,
  extractPointsTaxValues,
  parseBrNumber,
} = require('../src/scrapers/fare-parser');
const { analyze, isGoodDeal, impliedPointValuePer1000, pointsVerdict } = require('../src/analyze');
const { render, buildSeries } = require('../scripts/render-dashboard');
const { AIRLINES, getAirline, getEnabledAirlines } = require('../src/scrapers');
const {
  looksLikeResults,
  looksLikeNetworkError,
  looksLikeBotBlock,
  classifyPage,
} = require('../src/scrapers/base');
const { parseGoogleFlightsHtml, buildUrl } = require('../src/scrapers/google-flights');
const { parseArgs } = require('../scripts/run-scrape');
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

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

// --- parser -----------------------------------------------------------

test('parseBrNumber converte formato brasileiro', () => {
  assert.strictEqual(parseBrNumber('1.234,56'), 1234.56);
  assert.strictEqual(parseBrNumber('843,21'), 843.21);
});

test('Azul: extrai tarifas ignorando linhas de taxa', () => {
  const values = extractCashValues(fixture('azul-results.txt'));
  assert.deepStrictEqual(values, [843.21, 1102.0, 799.0]);
});

test('Azul: extrai pontos, incluindo formato "mil"', () => {
  const values = extractPointsValues(fixture('azul-results.txt'));
  assert.deepStrictEqual(values, [38500, 45200, 36500]);
});

test('GOL: entende "milhas" e separa a taxa de embarque', () => {
  const text = fixture('gol-results.txt');
  const parsed = parseSearchResultsText(text);
  assert.strictEqual(parsed.lowestCash, 912.4);
  assert.strictEqual(parsed.lowestPoints, 41000);
  assert.strictEqual(parsed.lowestPointsTax, 94.2);
  // "47,5 mil milhas" -> 47500
  assert.ok(extractPointsValues(text).includes(47500));
});

test('LATAM: entende "pontos" e a taxa escrita como "em taxas"', () => {
  const parsed = parseSearchResultsText(fixture('latam-results.txt'));
  assert.strictEqual(parsed.lowestCash, 1180.0);
  assert.strictEqual(parsed.lowestPoints, 52000);
  assert.strictEqual(parsed.lowestPointsTax, 78.5);
});

test('taxa de embarque nunca vira "menor preco em dinheiro"', () => {
  for (const name of ['azul-results.txt', 'gol-results.txt', 'latam-results.txt']) {
    const parsed = parseSearchResultsText(fixture(name));
    const taxes = extractPointsTaxValues(fixture(name));
    for (const tax of taxes) {
      assert.ok(parsed.lowestCash > tax, `${name}: menor tarifa (${parsed.lowestCash}) deveria ser > taxa (${tax})`);
    }
  }
});

test('texto sem preco nenhum devolve nulls em vez de quebrar', () => {
  const parsed = parseSearchResultsText('Nenhum voo encontrado para esta data.');
  assert.strictEqual(parsed.lowestCash, null);
  assert.strictEqual(parsed.lowestPoints, null);
});

// --- registro de companhias -------------------------------------------

test('todas as companhias registradas tem a interface esperada', () => {
  for (const [id, airline] of Object.entries(AIRLINES)) {
    assert.strictEqual(airline.id, id, `id de ${id} nao bate com a chave do registro`);
    assert.ok(airline.name, `${id} sem name`);
    assert.ok(airline.loyaltyProgram, `${id} sem loyaltyProgram`);
    assert.ok(airline.homeUrl, `${id} sem homeUrl`);
    assert.strictEqual(typeof airline.buildCashUrl, 'function', `${id} sem buildCashUrl`);
    const url = airline.buildCashUrl(cfg, '2026-12-20', '2027-01-05');
    assert.ok(url.startsWith('https://'), `${id}: buildCashUrl nao gerou https`);
    assert.ok(url.includes('REC') && url.includes('CWB'), `${id}: URL sem a rota`);
    if (airline.buildPointsUrl) {
      const pUrl = airline.buildPointsUrl(cfg, '2026-12-20', '2027-01-05');
      assert.ok(pUrl.startsWith('https://'), `${id}: buildPointsUrl nao gerou https`);
      assert.notStrictEqual(pUrl, url, `${id}: URL de pontos igual a de dinheiro`);
    }
  }
});

test('toda companhia do config existe no registro', () => {
  for (const id of Object.keys(cfg.airlines)) getAirline(id);
  assert.strictEqual(getEnabledAirlines(cfg).length, 3);
});

test('companhia desconhecida da erro claro', () => {
  assert.throws(() => getAirline('varig'), /Companhia desconhecida/);
});

// --- deteccao de pagina carregada vs erro de rede ---------------------

test('looksLikeResults aceita pagina com preco e recusa pagina vazia', () => {
  assert.strictEqual(looksLikeResults('A partir de R$ 843,21'), true);
  assert.strictEqual(looksLikeResults('41.000 milhas'), true);
  assert.strictEqual(looksLikeResults('Bem-vindo! Planeje sua viagem'), false);
});

test('looksLikeNetworkError distingue erro do navegador de tela sem resultado', () => {
  // Pagina de erro real do Chromium, em ingles e em portugues.
  assert.strictEqual(looksLikeNetworkError("This site can't be reached\nERR_CONNECTION_RESET"), true);
  assert.strictEqual(looksLikeNetworkError('Não é possível acessar esse site'), true);
  // Uma busca legitima que so nao achou voo NAO e erro de rede.
  assert.strictEqual(looksLikeNetworkError('Nenhum voo encontrado para esta data.'), false);
  assert.strictEqual(looksLikeNetworkError('A partir de R$ 843,21'), false);
});

test('looksLikeBotBlock reconhece telas de protecao anti-bot', () => {
  assert.strictEqual(looksLikeBotBlock('Access Denied\nReference #18.abcd'), true);
  assert.strictEqual(looksLikeBotBlock('Pardon Our Interruption'), true);
  assert.strictEqual(looksLikeBotBlock('Checking your browser before accessing'), true);
  assert.strictEqual(looksLikeBotBlock('Please complete the captcha to continue'), true);
  // Uma pagina de resultados legitima nao pode cair aqui.
  assert.strictEqual(looksLikeBotBlock('A partir de R$ 843,21'), false);
  // O HTML do Google Voos menciona "/recaptcha/challenge" no JS; isso NAO e bloqueio.
  assert.strictEqual(looksLikeBotBlock('"/producer/*","/recaptcha/challenge","/r"'), false);
});

test('classifyPage separa os quatro desfechos possiveis', () => {
  assert.strictEqual(classifyPage('A partir de R$ 843,21'), 'resultados');
  assert.strictEqual(classifyPage('41.000 milhas'), 'resultados');
  assert.strictEqual(classifyPage('Access Denied Reference #18.x'), 'bloqueio-anti-bot');
  assert.strictEqual(classifyPage("This site can't be reached ERR_CONNECTION_RESET"), 'erro-de-rede');
  assert.strictEqual(classifyPage('Planeje sua viagem com a gente'), 'carregou-sem-precos');
  assert.strictEqual(classifyPage(''), 'vazia');
  assert.strictEqual(classifyPage('   '), 'vazia');
});

test('bloqueio anti-bot tem prioridade sobre "carregou sem precos"', () => {
  // Uma tela de bloqueio nao pode ser diagnosticada como layout mudado:
  // mandaria o investigador mexer em seletor a toa.
  const bloqueio = 'Access Denied\nYou don\'t have permission to access this resource.';
  assert.strictEqual(classifyPage(bloqueio), 'bloqueio-anti-bot');
});

test('LATAM Access Denied em espanhol e bloqueio, nao formulario sumido', () => {
  const text = fixture('latam-access-denied.txt');
  assert.strictEqual(looksLikeBotBlock(text), true);
  assert.strictEqual(classifyPage(text), 'bloqueio-anti-bot');
});

// --- Google Voos ------------------------------------------------------

test('Google Voos: URL inclui rota, datas e moeda BRL', () => {
  const url = buildUrl(cfg, '2026-12-20', '2027-01-05');
  assert.ok(url.startsWith('https://www.google.com/travel/flights?'));
  assert.ok(url.includes('curr=BRL'));
  assert.ok(url.includes('hl=pt-BR'));
  assert.ok(url.includes('REC'));
  assert.ok(url.includes('CWB'));
  assert.ok(url.includes('2026-12-20'));
  assert.ok(url.includes('2027-01-05'));
});

test('Google Voos: extrai o menor preco de cada cia e ignora itinerario misto', () => {
  const parsed = parseGoogleFlightsHtml(fixture('google-flights-results.html'));
  assert.strictEqual(parsed.latam, 1956);
  assert.strictEqual(parsed.gol, 2512);
  assert.strictEqual(parsed.azul, 2666);
  // 999 era o trecho misto LA+G3; nao pode vencer como menor preco.
  assert.ok(parsed.latam !== 999);
  assert.ok(parsed.gol !== 999);
});

test('Google Voos: HTML sem tarifas devolve objeto vazio', () => {
  const parsed = parseGoogleFlightsHtml('<html><body>Planeje sua viagem</body></html>');
  assert.deepStrictEqual(parsed, {});
});

test('CLI: fonte padrao e google, delay menor que o das cias', () => {
  const defaults = parseArgs([]);
  assert.strictEqual(defaults.source, 'google');
  assert.strictEqual(defaults.delay, 1200);
  const airlines = parseArgs(['--source=airlines']);
  assert.strictEqual(airlines.source, 'airlines');
  assert.strictEqual(airlines.delay, 3000);
  const custom = parseArgs(['--source=all', '--delay=500', '--quick']);
  assert.strictEqual(custom.source, 'all');
  assert.strictEqual(custom.delay, 500);
  assert.strictEqual(custom.quick, true);
});

test('CLI: fonte desconhecida da erro claro', () => {
  assert.throws(() => parseArgs(['--source=skyscanner']), /Fonte desconhecida/);
});

// --- analise ----------------------------------------------------------

test('impliedPointValuePer1000 calcula o valor do ponto', () => {
  const value = impliedPointValuePer1000({ cashTotal: 843.21, pointsTotal: 38500, pointsTax: 89.9 });
  // (843.21 - 89.90) / 38500 * 1000 ~= 19.57
  assert.ok(Math.abs(value - 19.57) < 0.1, `esperava ~19.57, recebi ${value}`);
});

test('pointsVerdict compara valor extraido com custo de compra', () => {
  // Valor do ponto bem alto -> compensa resgatar.
  const bom = pointsVerdict(cfg, { airline: 'azul', cashTotal: 2000, pointsTotal: 20000, pointsTax: 90 });
  assert.strictEqual(bom.worthIt, true);
  // Valor do ponto baixo -> melhor pagar em dinheiro.
  const ruim = pointsVerdict(cfg, { airline: 'azul', cashTotal: 400, pointsTotal: 40000, pointsTax: 90 });
  assert.strictEqual(ruim.worthIt, false);
});

const sampleEntries = [
  { scrapedAt: '2026-08-01T10:00:00Z', airline: 'azul', airlineName: 'Azul', loyaltyProgram: 'TudoAzul', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 1000, pointsTotal: 42000, pointsTax: 89.9 },
  { scrapedAt: '2026-08-03T10:00:00Z', airline: 'azul', airlineName: 'Azul', loyaltyProgram: 'TudoAzul', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 950, pointsTotal: 40000, pointsTax: 89.9 },
  { scrapedAt: '2026-08-05T10:00:00Z', airline: 'azul', airlineName: 'Azul', loyaltyProgram: 'TudoAzul', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 1100, pointsTotal: 45000, pointsTax: 89.9 },
  { scrapedAt: '2026-08-05T11:00:00Z', airline: 'gol', airlineName: 'GOL', loyaltyProgram: 'Smiles', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 880, pointsTotal: 41000, pointsTax: 94.2 },
  { scrapedAt: '2026-08-06T11:00:00Z', airline: 'latam', airlineName: 'LATAM', loyaltyProgram: 'LATAM Pass', departDate: '2026-12-22', returnDate: '2027-01-05', cashTotal: 700, pointsTotal: 30000, pointsTax: 78.5 },
];

test('analyze separa resultados por companhia', () => {
  const result = analyze(cfg, sampleEntries);
  assert.strictEqual(result.totalSamples, 5);
  assert.strictEqual(result.lowestCash.cashTotal, 700);
  assert.strictEqual(result.lowestCash.airline, 'latam');
  assert.strictEqual(result.lowestPoints.pointsTotal, 30000);
  assert.strictEqual(result.airlineSummaries.length, 3);
  // Ordenado pelo menor preco em dinheiro.
  assert.strictEqual(result.airlineSummaries[0].airline, 'latam');
});

test('pairSummaries diz qual companhia deu o melhor preco', () => {
  const result = analyze(cfg, sampleEntries);
  const pair = result.pairSummaries.find((p) => p.departDate === '2026-12-20');
  assert.strictEqual(pair.lowestCash, 880);
  assert.strictEqual(pair.lowestCashAirline, 'GOL');
});

test('isGoodDeal usa a media da propria companhia, nao a media geral', () => {
  // A Azul tem 3 amostras proprias (1000, 950, 1100; media 1016,7). 950
  // NAO e bom negocio para a Azul, mesmo sendo caro perto do geral.
  const azulEntry = sampleEntries[1];
  assert.strictEqual(isGoodDeal(cfg, azulEntry, sampleEntries), false);

  // Uma Azul bem abaixo da propria media entra como bom negocio.
  const azulBarata = { ...azulEntry, cashTotal: 600 };
  assert.strictEqual(isGoodDeal(cfg, azulBarata, [...sampleEntries, azulBarata]), true);
});

// --- dashboard --------------------------------------------------------

test('buildSeries agrupa por companhia em ordem estavel de slot', () => {
  const series = buildSeries(sampleEntries, 'cashTotal');
  assert.deepStrictEqual(series.map((s) => s.id), ['azul', 'gol', 'latam']);
  assert.strictEqual(series[0].points.length, 3);
});

test('buildSeries reduz o dia ao menor preco, nao a uma media nem ao ultimo', () => {
  // Tres consultas da Azul no mesmo dia, de pares de datas diferentes: a
  // linha deve mostrar so a mais barata (900), senao um dia com uma data
  // cara pareceria "o preco subiu".
  const mesmoDia = [
    { scrapedAt: '2026-08-10T09:00:00Z', airline: 'azul', airlineName: 'Azul', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 1500 },
    { scrapedAt: '2026-08-10T09:05:00Z', airline: 'azul', airlineName: 'Azul', departDate: '2026-12-25', returnDate: '2027-01-05', cashTotal: 900 },
    { scrapedAt: '2026-08-10T09:10:00Z', airline: 'azul', airlineName: 'Azul', departDate: '2026-12-31', returnDate: '2027-01-05', cashTotal: 2100 },
  ];
  const series = buildSeries(mesmoDia, 'cashTotal');
  assert.strictEqual(series.length, 1);
  assert.strictEqual(series[0].points.length, 1, 'deveria virar um ponto so no dia');
  assert.strictEqual(series[0].points[0].v, 900);
  // E o tooltip aponta para o par de datas que gerou esse menor preco.
  assert.strictEqual(series[0].points[0].entry.departDate, '2026-12-25');
});

test('render gera HTML com as tres companhias e a legenda', () => {
  const analysis = analyze(cfg, sampleEntries);
  const html = render({
    cfg, entries: sampleEntries, analysis,
    goodDeals: new Set(['2026-12-22_2027-01-05']),
    generatedAt: new Date().toISOString(),
  });
  assert.ok(html.startsWith('<!doctype html>'));
  for (const name of ['Recife', 'Curitiba', 'Azul', 'GOL', 'LATAM', 'TudoAzul', 'Smiles', 'LATAM Pass']) {
    assert.ok(html.includes(name), `dashboard sem "${name}"`);
  }
  assert.ok(html.includes('legend-item'), 'dashboard sem legenda');
  assert.ok(html.includes('bom preço'), 'dashboard sem marcacao de bom preco');
});

test('cores sao fixas por companhia, nao por posicao no ranking', () => {
  const base = analyze(cfg, sampleEntries);
  const htmlA = render({ cfg, entries: sampleEntries, analysis: base, goodDeals: new Set(), generatedAt: '2026-08-07T00:00:00Z' });

  // Inverte a ordem das entradas (muda o ranking) e confere que cada
  // companhia manteve a mesma variavel de cor.
  const reversed = [...sampleEntries].reverse();
  const htmlB = render({ cfg, entries: reversed, analysis: analyze(cfg, reversed), goodDeals: new Set(), generatedAt: '2026-08-07T00:00:00Z' });

  for (const id of ['azul', 'gol', 'latam']) {
    assert.ok(htmlA.includes(`var(--series-${id})`), `htmlA sem cor de ${id}`);
    assert.ok(htmlB.includes(`var(--series-${id})`), `htmlB sem cor de ${id}`);
  }
  // A definicao da cor de cada companhia e identica nos dois.
  const slotDef = /--series-azul: (#[0-9a-f]{6})/i;
  assert.strictEqual(htmlA.match(slotDef)[1], htmlB.match(slotDef)[1]);
});

test('render lida com historico vazio sem quebrar', () => {
  const analysis = analyze(cfg, []);
  const html = render({ cfg, entries: [], analysis, goodDeals: new Set(), generatedAt: new Date().toISOString() });
  assert.ok(html.includes('sem dados'));
  assert.ok(html.includes('Ainda não há histórico suficiente'));
});

test('render lida com companhia sem dados de pontos', () => {
  const soDinheiro = [{ scrapedAt: '2026-08-01T10:00:00Z', airline: 'gol', airlineName: 'GOL', departDate: '2026-12-20', returnDate: '2027-01-05', cashTotal: 900, pointsTotal: null }];
  const html = render({ cfg, entries: soDinheiro, analysis: analyze(cfg, soDinheiro), goodDeals: new Set(), generatedAt: new Date().toISOString() });
  assert.ok(html.includes('GOL'));
});

console.log(`\n${passed} teste(s) passaram.`);
