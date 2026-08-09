const fs = require('fs');
const path = require('path');

function historyPath(cfg) {
  return path.resolve(process.cwd(), cfg.paths.historyFile);
}

function loadHistory(cfg) {
  const file = historyPath(cfg);
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file, 'utf8').trim();
  if (!raw) return [];
  return JSON.parse(raw);
}

function saveHistory(cfg, entries) {
  const file = historyPath(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(entries, null, 2) + '\n', 'utf8');
}

// entry: { scrapedAt, departDate, returnDate, origin, destination,
//          cashTotal, currency, pointsTotal, pointsTax, source, notes }
function appendEntry(cfg, entry) {
  const entries = loadHistory(cfg);
  entries.push(entry);
  saveHistory(cfg, entries);
  return entries;
}

module.exports = { loadHistory, saveHistory, appendEntry, historyPath };
