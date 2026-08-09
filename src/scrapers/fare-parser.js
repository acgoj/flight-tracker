// Extrai precos (dinheiro e pontos/milhas) do TEXTO VISIVEL de uma pagina
// de resultados de busca de voos. Compartilhado por todas as companhias -
// o formato de preco brasileiro e o mesmo em todas ("R$ 1.234,56"), muda
// so o vocabulario de fidelidade ("pontos" na Azul/LATAM, "milhas" na
// GOL/Smiles).
//
// IMPORTANTE - por que regex sobre texto visivel em vez de seletores CSS:
// nao foi possivel acessar os sites ao vivo a partir do ambiente onde este
// codigo foi escrito (bloqueado por protecao anti-bot), entao nao da para
// confiar em classes/data-testid especificos, que podem estar errados ou
// mudar a qualquer redesign. Buscar por padroes de texto tende a
// sobreviver melhor a mudancas de layout do que seletores adivinhados.
// Se a extracao vier vazia, rode com `--debug` (salva screenshot + html em
// debug/) para investigar e ajustar os padroes abaixo.

// "R$ 1.234,56" ou "R$1234,56" -> 1234.56
const CASH_RE = /R\$\s*([\d.]+,\d{2})/g;

// "38.500 pontos", "38500 milhas", "38,5 mil pontos", "12.000 pts"
const POINTS_RE = /([\d.,]+)\s*(mil\s+)?(?:pontos?|milhas?|pts)\b/gi;

function parseBrNumber(str) {
  return parseFloat(str.replace(/\./g, '').replace(',', '.'));
}

// Distingue a linha da tarifa em si da linha de taxa de embarque cobrada
// junto com a opcao em pontos (ex.: "+ R$ 89,90 de taxas"). Sem isso, a
// taxa "venceria" como menor preco em dinheiro por ser um valor pequeno.
function isFareLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('+')) return false;
  if (/taxa|tarifa de embarque/i.test(trimmed)) return false;
  return true;
}

function matchAllCash(line) {
  const values = [];
  let m;
  CASH_RE.lastIndex = 0;
  while ((m = CASH_RE.exec(line)) !== null) {
    const v = parseBrNumber(m[1]);
    if (!Number.isNaN(v) && v > 0) values.push(v);
  }
  return values;
}

function extractCashValues(text) {
  const values = [];
  for (const line of text.split('\n')) {
    if (isFareLine(line)) values.push(...matchAllCash(line));
  }
  return values;
}

// Taxa de embarque cobrada junto com a opcao em pontos/milhas.
function extractPointsTaxValues(text) {
  const values = [];
  for (const line of text.split('\n')) {
    if (!isFareLine(line)) values.push(...matchAllCash(line));
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

// Retorna o menor preco em dinheiro, o menor em pontos/milhas e a menor
// taxa de embarque identificavel. Aproximacao best-effort - valide contra
// debug/*.html no primeiro uso de cada companhia.
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
  isFareLine,
};
