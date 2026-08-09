// Gera o HTML estatico do dashboard a partir do historico + analise.
// Mantido separado de build-dashboard.js para poder ser testado sem tocar
// no disco (recebe dados, devolve string HTML).

function esc(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtCash(v) {
  if (v == null) return '—';
  return 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPoints(v) {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR') + ' pts';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function priceHistorySvg(entries) {
  const cashEntries = entries
    .filter((e) => e.cashTotal != null)
    .sort((a, b) => new Date(a.scrapedAt) - new Date(b.scrapedAt));
  if (cashEntries.length < 2) return '<p class="muted">Ainda nao ha historico suficiente para o grafico (minimo 2 pontos).</p>';

  const width = 720;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 30, left: 70 };
  const values = cashEntries.map((e) => e.cashTotal);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const times = cashEntries.map((e) => new Date(e.scrapedAt).getTime());
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tRange = tMax - tMin || 1;

  const x = (t) => padding.left + ((t - tMin) / tRange) * (width - padding.left - padding.right);
  const y = (v) => height - padding.bottom - ((v - min) / range) * (height - padding.top - padding.bottom);

  const points = cashEntries.map((e) => `${x(new Date(e.scrapedAt).getTime()).toFixed(1)},${y(e.cashTotal).toFixed(1)}`);
  const path = 'M' + points.join(' L');

  const yTicks = [min, (min + max) / 2, max];

  return `
  <svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Historico de preco em dinheiro">
    ${yTicks
      .map(
        (v) => `<line x1="${padding.left}" y1="${y(v).toFixed(1)}" x2="${width - padding.right}" y2="${y(v).toFixed(1)}" class="gridline" />
                 <text x="${padding.left - 8}" y="${y(v).toFixed(1)}" class="axis-label" text-anchor="end" dominant-baseline="middle">${fmtCash(v)}</text>`
      )
      .join('')}
    <path d="${path}" class="chart-line" fill="none" />
    ${cashEntries
      .map(
        (e) =>
          `<circle cx="${x(new Date(e.scrapedAt).getTime()).toFixed(1)}" cy="${y(e.cashTotal).toFixed(1)}" r="3" class="chart-dot">
             <title>${fmtDateTime(e.scrapedAt)}: ${fmtCash(e.cashTotal)} (${fmtDate(e.departDate)} - ${fmtDate(e.returnDate)})</title>
           </circle>`
      )
      .join('')}
  </svg>`;
}

function pairRows(pairSummaries, goodDeals) {
  if (!pairSummaries.length) {
    return '<tr><td colspan="4" class="muted">Sem dados ainda.</td></tr>';
  }
  return pairSummaries
    .map((p) => {
      const isGood = goodDeals.has(`${p.departDate}_${p.returnDate}`);
      return `<tr class="${isGood ? 'good-deal' : ''}">
        <td>${fmtDate(p.departDate)} → ${fmtDate(p.returnDate)}</td>
        <td>${fmtCash(p.lowestCash)}${isGood ? ' <span class="badge">bom preço</span>' : ''}</td>
        <td>${fmtPoints(p.lowestPoints)}</td>
        <td>${p.samples}</td>
      </tr>`;
    })
    .join('');
}

function render({ cfg, entries, analysis, goodDeals, generatedAt }) {
  const { route } = cfg;
  const title = `${route.originName} → ${route.destinationName}: monitor de passagens`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0f1216;
    --card: #171b21;
    --text: #e8eaed;
    --muted: #9aa4b2;
    --accent: #5b9dff;
    --good: #2fbf71;
    --border: #262b33;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f7f8fa;
      --card: #ffffff;
      --text: #1b1f24;
      --muted: #5b6472;
      --accent: #2563eb;
      --good: #1a8f52;
      --border: #e3e6eb;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 24px 16px 64px;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitle { color: var(--muted); margin-top: 0; margin-bottom: 24px; font-size: 0.95rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 28px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .card .label { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
  .card .value { font-size: 1.4rem; font-weight: 600; }
  .card .sub { color: var(--muted); font-size: 0.8rem; margin-top: 4px; }
  section { margin-bottom: 32px; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; }
  tr.good-deal td { background: color-mix(in srgb, var(--good) 12%, transparent); }
  .badge { background: var(--good); color: #06210f; font-size: 0.7rem; padding: 2px 6px; border-radius: 999px; font-weight: 600; }
  .muted { color: var(--muted); }
  .chart { width: 100%; height: auto; }
  .chart-line { stroke: var(--accent); stroke-width: 2; }
  .chart-dot { fill: var(--accent); }
  .gridline { stroke: var(--border); stroke-width: 1; }
  .axis-label { fill: var(--muted); font-size: 10px; }
  footer { color: var(--muted); font-size: 0.8rem; margin-top: 40px; }
  code { background: var(--card); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="subtitle">Ida ${fmtDate(cfg.departureWindow.start)}–${fmtDate(cfg.departureWindow.end)} · Volta ${fmtDate(cfg.returnWindow.start)}–${fmtDate(cfg.returnWindow.end)} · Programa: ${esc(cfg.loyaltyProgram)} · Atualizado em ${fmtDateTime(generatedAt)}</p>

  <div class="cards">
    <div class="card">
      <div class="label">Menor preço em dinheiro</div>
      <div class="value">${fmtCash(analysis.lowestCash?.cashTotal)}</div>
      <div class="sub">${analysis.lowestCash ? fmtDate(analysis.lowestCash.departDate) + ' → ' + fmtDate(analysis.lowestCash.returnDate) : 'sem dados'}</div>
    </div>
    <div class="card">
      <div class="label">Menor preço em pontos</div>
      <div class="value">${fmtPoints(analysis.lowestPoints?.pointsTotal)}</div>
      <div class="sub">${analysis.lowestPoints ? fmtDate(analysis.lowestPoints.departDate) + ' → ' + fmtDate(analysis.lowestPoints.returnDate) : 'sem dados'}</div>
    </div>
    <div class="card">
      <div class="label">Valor médio do ponto</div>
      <div class="value">${analysis.avgImpliedPointValue != null ? fmtCash(analysis.avgImpliedPointValue) + '/1000' : '—'}</div>
      <div class="sub">Custo de compra: ${fmtCash(cfg.pointsPurchaseCostPer1000)}/1000</div>
    </div>
    <div class="card">
      <div class="label">Amostras coletadas</div>
      <div class="value">${analysis.totalSamples}</div>
      <div class="sub">${entries.length ? 'desde ' + fmtDateTime(entries[0].scrapedAt) : 'nenhuma ainda'}</div>
    </div>
  </div>

  <section>
    <h2>Histórico de preço em dinheiro</h2>
    ${priceHistorySvg(entries)}
  </section>

  <section>
    <h2>Melhores combinações de data já vistas</h2>
    <table>
      <thead><tr><th>Ida → Volta</th><th>Menor R$</th><th>Menor pontos</th><th>Amostras</th></tr></thead>
      <tbody>${pairRows(analysis.pairSummaries, goodDeals)}</tbody>
    </table>
  </section>

  <footer>
    Gerado automaticamente a partir de <code>data/history.json</code>. Preços em pontos são do programa ${esc(cfg.loyaltyProgram)}.
    "Bom preço" = pelo menos ${Math.round(cfg.goodDealThreshold * 100)}% abaixo da média histórica para o mesmo par de datas.
    Dados coletados por scraping best-effort; podem estar desatualizados ou faltando se o site de origem mudou de layout —
    use <code>npm run add-price</code> para complementar manualmente.
  </footer>
</div>
</body>
</html>`;
}

module.exports = { render, fmtCash, fmtPoints, fmtDate, fmtDateTime };
