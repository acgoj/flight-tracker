// Extrai precos (dinheiro e pontos) do TEXTO VISIVEL da pagina de resultados
// de busca da Azul/TudoAzul.
//
// IMPORTANTE - por que regex sobre texto visivel em vez de seletores CSS:
// nao foi possivel acessar o site ao vivo a partir do ambiente onde este
// codigo foi escrito (bloqueado por protecao anti-bot), entao nao da para
// confiar em classes/data-testid especificos, que podem estar errados ou
// mudar a qualquer redesign. Buscar por padroes de texto ("R$ 1.234,56",
// "38.500 pontos") tende a sobreviver melhor a mudancas de layout do que
// seletores adivinhados. Se a extracao vier vazia, use `--debug` (salva
// screenshot + html em debug/) para investigar e ajustar os padroes abaixo.

// "R$ 1.234,56" ou "R$1234,56" -> 1234.56
const CASH_RE = /R\$\s*([\d.]+,\d{2})/g;

// "38.500 pontos", "38500 pontos", "38,5 mil pontos" -> pontos inteiros
const POINTS_RE = /([\d.,]+)\s*(mil\s+)?pontos/gi;

function parseBrNumber(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

// So conta valores em R$ de linhas que sao a tarifa em si, nao a taxa de
// embarque cobrada junto com pontos (ex.: "+ R$ 89,90 de taxas"), que
// senao "venceria" como o menor preco por ser um valor pequeno.
function isFareLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('+')) return false;
  if (/taxa/i.test(trimmed)) return false;
  return true;
}

function extractCashValues(text) {
  const values = [];
  for (const line of text.split('\n')) {
    if (!isFareLine(line)) continue;
    let m;
    CASH_RE.lastIndex = 0;
    while ((m = CASH_RE.exec(line)) !== null) {
      const v = parseBrNumber(m[1]);
      if (!Number.isNaN(v) && v > 0) values.push(v);
    }
  }
  return values;
}

// Taxa de embarque cobrada junto com a opcao em pontos (linhas com "+" ou
// "taxa"). Usado como pointsTax quando disponivel.
function extractPointsTaxValues(text) {
  const values = [];
  for (const line of text.split('\n')) {
    if (isFareLine(line)) continue;
    let m;
    CASH_RE.lastIndex = 0;
    while ((m = CASH_RE.exec(line)) !== null) {
      const v = parseBrNumber(m[1]);
      if (!Number.isNaN(v) && v > 0) values.push(v);
    }
  }
  return values;
}

function extractPointsValues(text) {
  const values = [];
  let m;
  POINTS_RE.lastIndex = 0;
  while ((m = POINTS_RE.exec(text)) !== null) {
    let v = parseBrNumber(m[1]);
    if (Number.isNaN(v)) continue;
    if (m[2]) v *= 1000; // "X mil pontos"
    if (v > 0) values.push(Math.round(v));
  }
  return values;
}

// Retorna o menor preco em dinheiro e o menor em pontos encontrados no
// texto da pagina de resultados, alem da menor taxa de embarque cobrada
// junto com a opcao em pontos (quando identificavel). Isso e uma
// aproximacao best-effort - valide contra debug/*.html no primeiro uso.
function parseSearchResultsText(text) {
  const cashValues = extractCashValues(text);
  const pointsValues = extractPointsValues(text);
  const pointsTaxValues = extractPointsTaxValues(text);

  return {
    lowestCash: cashValues.length ? Math.min(...cashValues) : null,
    lowestPoints: pointsValues.length ? Math.min(...pointsValues) : null,
    lowestPointsTax: pointsTaxValues.length ? Math.min(...pointsTaxValues) : null,
    allCashValues: cashValues,
    allPointsValues: pointsValues,
  };
}

module.exports = {
  parseSearchResultsText,
  extractCashValues,
  extractPointsValues,
  extractPointsTaxValues,
  parseBrNumber,
};
