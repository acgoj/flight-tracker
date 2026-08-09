// Registro das companhias suportadas.
//
// Para adicionar uma companhia nova: crie um modulo no padrao dos
// existentes (id, name, loyaltyProgram, homeUrl, buildCashUrl, e
// opcionalmente buildPointsUrl/formSelectors), registre aqui, e habilite
// em src/config.js -> airlines.

const azul = require('./azul');
const gol = require('./gol');
const latam = require('./latam');

const AIRLINES = { azul, gol, latam };

function getAirline(id) {
  const airline = AIRLINES[id];
  if (!airline) {
    throw new Error(`Companhia desconhecida: "${id}". Disponiveis: ${Object.keys(AIRLINES).join(', ')}`);
  }
  return airline;
}

// Companhias habilitadas no config, na ordem de declaracao.
function getEnabledAirlines(cfg) {
  return Object.entries(cfg.airlines)
    .filter(([, settings]) => settings.enabled)
    .map(([id]) => getAirline(id));
}

module.exports = { AIRLINES, getAirline, getEnabledAirlines };
