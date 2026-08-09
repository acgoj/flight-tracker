// Gera o HTML estatico do dashboard a partir do historico + analise.
// Mantido separado de build-dashboard.js para poder ser testado sem tocar
// no disco (recebe dados, devolve string HTML).

// Paleta categorica validada (checks de banda de luminosidade, croma,
// separacao para daltonismo e contraste rodados nos dois modos).
// A cor segue a COMPANHIA, nunca a posicao no ranking: filtrar ou reordenar
// nao pode repintar as series, senao quem aprendeu "Azul e azul" se perde.
const SERIES_SLOTS = [
  { light: '#2a78d6', dark: '#3987e5' }, // 1 azul
  { light: '#eb6834', dark: '#d95926' }, // 2 laranja
  { light: '#1baf7a', dark: '#199e70' }, // 3 verde-agua
  { light: '#eda100', dark: '#c98500' }, // 4 amarelo (reserva)
];
const AIRLINE_SLOT = { azul: 0, gol: 1, latam: 2 };

function slotFor(airlineId) {
  const idx = AIRLINE_SLOT[airlineId];
  return idx == null ? SERIES_SLOTS.length - 1 : idx;
}

function colorVar(airlineId) {
  return `var(--series-${airlineId in AIRLINE_SLOT ? airlineId : 'outra'})`;
}

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
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

// Agrupa as entradas em series por companhia para um campo numerico.
//
// Cada execucao do scraper consulta VARIOS pares de datas, entao um dia de
// coleta gera varias entradas por companhia. Plotar todas em uma linha so
// misturaria "o preco subiu" com "essa data e mais cara". Por isso cada
// ponto da serie e o MENOR valor daquela companhia naquele dia - ou seja,
// "a melhor passagem disponivel naquele dia", que e o que um monitor de
// preco precisa mostrar.
function buildSeries(entries, field) {
  const byAirline = new Map();

  for (const e of entries) {
    if (e[field] == null) continue;
    const id = e.airline || 'outra';
    if (!byAirline.has(id)) {
      byAirline.set(id, { id, name: e.airlineName || id, days: new Map() });
    }
    const days = byAirline.get(id).days;
    const day = e.scrapedAt.slice(0, 10);
    const current = days.get(day);
    if (!current || e[field] < current.v) {
      days.set(day, { t: new Date(day + 'T12:00:00Z').getTime(), v: e[field], entry: e });
    }
  }

  return Array.from(byAirline.values())
    .map((s) => ({
      id: s.id,
      name: s.name,
      points: Array.from(s.days.values()).sort((a, b) => a.t - b.t),
    }))
    // Ordem estavel por slot, para a legenda nao dancar entre execucoes.
    .sort((a, b) => slotFor(a.id) - slotFor(b.id));
}

// Grafico de linhas multi-serie. Um eixo Y so - se precisar comparar
// dinheiro e pontos, sao DOIS graficos separados, nunca eixo duplo.
function lineChart(series, { fmtValue, label }) {
  const totalPoints = series.reduce((n, s) => n + s.points.length, 0);
  if (totalPoints < 2) {
    return `<p class="muted">Ainda não há histórico suficiente para o gráfico (mínimo 2 coletas).</p>`;
  }

  const width = 760;
  const height = 260;
  const pad = { top: 16, right: 96, bottom: 28, left: 78 };

  const allValues = series.flatMap((s) => s.points.map((p) => p.v));
  const allTimes = series.flatMap((s) => s.points.map((p) => p.t));
  const vMin = Math.min(...allValues);
  const vMax = Math.max(...allValues);
  const vRange = vMax - vMin || Math.max(vMax * 0.1, 1);
  const tMin = Math.min(...allTimes);
  const tMax = Math.max(...allTimes);
  const tRange = tMax - tMin || 1;

  const x = (t) => pad.left + ((t - tMin) / tRange) * (width - pad.left - pad.right);
  const y = (v) => height - pad.bottom - ((v - vMin) / vRange) * (height - pad.top - pad.bottom);

  const yTicks = [vMin, (vMin + vMax) / 2, vMax];
  const grid = yTicks
    .map(
      (v) =>
        `<line x1="${pad.left}" y1="${y(v).toFixed(1)}" x2="${width - pad.right}" y2="${y(v).toFixed(1)}" class="gridline" />` +
        `<text x="${pad.left - 8}" y="${y(v).toFixed(1)}" class="axis-label" text-anchor="end" dominant-baseline="middle">${esc(fmtValue(v))}</text>`
    )
    .join('');

  // Rotulos diretos na ponta de cada serie, afastados verticalmente para
  // nao colidirem. O texto usa tinta de texto; a identidade vem do ponto
  // colorido ao lado (regra: texto nunca veste a cor da serie).
  const endLabels = series
    .filter((s) => s.points.length)
    .map((s) => {
      const last = s.points[s.points.length - 1];
      return { id: s.id, name: s.name, x: x(last.t), y: y(last.v) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i += 1) {
    if (endLabels[i].y - endLabels[i - 1].y < 15) endLabels[i].y = endLabels[i - 1].y + 15;
  }

  const paths = series
    .map((s) => {
      if (!s.points.length) return '';
      const color = colorVar(s.id);
      const d = 'M' + s.points.map((p) => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' L');
      const line =
        s.points.length > 1
          ? `<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`
          : '';
      // Anel de 2px na cor da superficie separa marcas sobrepostas.
      const dots = s.points
        .map(
          (p) =>
            `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2">` +
            `<title>${esc(s.name)} — ${esc(fmtValue(p.v))}\nmelhor do dia: ${esc(fmtDate(p.entry.departDate))} → ${esc(fmtDate(p.entry.returnDate))}\ncoletado em ${esc(fmtDateTime(p.entry.scrapedAt))}</title>` +
            `</circle>`
        )
        .join('');
      return line + dots;
    })
    .join('');

  const labels = endLabels
    .map(
      (l) =>
        `<circle cx="${(l.x + 12).toFixed(1)}" cy="${l.y.toFixed(1)}" r="3.5" fill="${colorVar(l.id)}" />` +
        `<text x="${(l.x + 20).toFixed(1)}" y="${l.y.toFixed(1)}" class="series-label" dominant-baseline="middle">${esc(l.name)}</text>`
    )
    .join('');

  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="${esc(label)}">${grid}${paths}${labels}</svg>`;
}

function legend(series) {
  if (series.length < 2) return '';
  return `<div class="legend">${series
    .map(
      (s) =>
        `<span class="legend-item"><span class="swatch" style="background:${colorVar(s.id)}"></span>${esc(s.name)}</span>`
    )
    .join('')}</div>`;
}

function airlineRows(summaries) {
  if (!summaries.length) return '<tr><td colspan="6" class="muted">Sem dados ainda.</td></tr>';
  return summaries
    .map((s) => {
      let verdict = '<span class="muted">—</span>';
      if (s.avgImpliedPointValue != null && s.pointsPurchaseCostPer1000 != null) {
        const worth = s.avgImpliedPointValue > s.pointsPurchaseCostPer1000;
        verdict = worth
          ? '<span class="verdict verdict-yes">vale resgatar</span>'
          : '<span class="verdict verdict-no">pagar em R$</span>';
      }
      return `<tr>
        <td><span class="swatch" style="background:${colorVar(s.airline)}"></span>${esc(s.airlineName)}<div class="cell-sub">${esc(s.loyaltyProgram || '')}</div></td>
        <td>${fmtCash(s.lowestCash ? s.lowestCash.cashTotal : null)}</td>
        <td>${fmtPoints(s.lowestPoints ? s.lowestPoints.pointsTotal : null)}</td>
        <td>${s.avgImpliedPointValue != null ? fmtCash(s.avgImpliedPointValue) : '—'}</td>
        <td>${s.pointsPurchaseCostPer1000 != null ? fmtCash(s.pointsPurchaseCostPer1000) : '—'}</td>
        <td>${verdict}</td>
      </tr>`;
    })
    .join('');
}

function pairRows(pairSummaries, goodDeals) {
  if (!pairSummaries.length) return '<tr><td colspan="4" class="muted">Sem dados ainda.</td></tr>';
  return pairSummaries
    .map((p) => {
      const isGood = goodDeals.has(`${p.departDate}_${p.returnDate}`);
      return `<tr class="${isGood ? 'good-deal' : ''}">
        <td>${fmtDate(p.departDate)} → ${fmtDate(p.returnDate)}</td>
        <td>${fmtCash(p.lowestCash)}${p.lowestCashAirline ? `<div class="cell-sub">${esc(p.lowestCashAirline)}</div>` : ''}${isGood ? ' <span class="badge">bom preço</span>' : ''}</td>
        <td>${fmtPoints(p.lowestPoints)}${p.lowestPointsAirline ? `<div class="cell-sub">${esc(p.lowestPointsAirline)}</div>` : ''}</td>
        <td>${p.samples}</td>
      </tr>`;
    })
    .join('');
}

function darkSurfaceVars() {
  return [
    '    --bg: #0f1216;',
    '    --surface: #171b21;',
    '    --text: #e8eaed;',
    '    --muted: #9aa4b2;',
    '    --good: #2fbf71;',
    '    --bad: #e08f6d;',
    '    --border: #262b33;',
  ].join('\n');
}

function seriesColorVars(mode) {
  const entries = Object.entries(AIRLINE_SLOT).map(
    ([id, idx]) => `    --series-${id}: ${SERIES_SLOTS[idx][mode]};`
  );
  entries.push(`    --series-outra: ${SERIES_SLOTS[SERIES_SLOTS.length - 1][mode]};`);
  return entries.join('\n');
}

function render({ cfg, entries, analysis, goodDeals, generatedAt }) {
  const { route } = cfg;
  const title = `${route.originName} → ${route.destinationName}: monitor de passagens`;

  const cashSeries = buildSeries(entries, 'cashTotal');
  const pointsSeries = buildSeries(entries, 'pointsTotal');
  const bestCash = analysis.lowestCash;
  const bestPoints = analysis.lowestPoints;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f8fa;
    --surface: #ffffff;
    --text: #1b1f24;
    --muted: #5b6472;
    --good: #1a8f52;
    --bad: #a1441f;
    --border: #e3e6eb;
${seriesColorVars('light')}
  }
  /* Modo escuro: passos proprios para a superficie escura, nao um flip
     automatico do claro. Declarado nos dois escopos - a media query cobre
     a preferencia do sistema, o [data-theme] cobre um toggle explicito. */
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
${seriesColorVars('dark')}
${darkSurfaceVars()}
    }
  }
  :root[data-theme="dark"] {
${seriesColorVars('dark')}
${darkSurfaceVars()}
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding: 24px 16px 64px;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 4px; }
  .subtitle { color: var(--muted); margin: 0 0 24px; font-size: 0.9rem; line-height: 1.5; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 32px; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .card .label { color: var(--muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
  .card .value { font-size: 1.35rem; font-weight: 600; }
  .card .sub { color: var(--muted); font-size: 0.8rem; margin-top: 4px; }
  section { margin-bottom: 36px; }
  h2 { font-size: 1.05rem; border-bottom: 1px solid var(--border); padding-bottom: 8px; margin-bottom: 14px; }
  .table-scroll { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; min-width: 460px; }
  th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; }
  .cell-sub { color: var(--muted); font-size: 0.78rem; margin-top: 2px; }
  tr.good-deal td { background: color-mix(in srgb, var(--good) 12%, transparent); }
  .badge { background: var(--good); color: #06210f; font-size: 0.7rem; padding: 2px 6px; border-radius: 999px; font-weight: 600; }
  .verdict { font-weight: 600; font-size: 0.82rem; }
  .verdict-yes { color: var(--good); }
  .verdict-no { color: var(--bad); }
  .muted { color: var(--muted); }
  .chart { width: 100%; height: auto; overflow: visible; }
  .gridline { stroke: var(--border); stroke-width: 1; }
  .axis-label { fill: var(--muted); font-size: 10px; }
  .series-label { fill: var(--muted); font-size: 11px; }
  .legend { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; font-size: 0.82rem; color: var(--muted); }
  .legend-item { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; margin-right: 6px; vertical-align: baseline; }
  .legend .swatch { margin-right: 0; }
  footer { color: var(--muted); font-size: 0.8rem; line-height: 1.6; margin-top: 40px; }
  code { background: var(--surface); border: 1px solid var(--border); padding: 1px 5px; border-radius: 4px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  <p class="subtitle">
    Ida ${fmtDate(cfg.departureWindow.start)}–${fmtDate(cfg.departureWindow.end)} ·
    Volta ${fmtDate(cfg.returnWindow.start)}–${fmtDate(cfg.returnWindow.end)} ·
    ${analysis.airlineSummaries.length} companhia(s) · Atualizado em ${fmtDateTime(generatedAt)}
  </p>

  <div class="cards">
    <div class="card">
      <div class="label">Menor preço em dinheiro</div>
      <div class="value">${fmtCash(bestCash ? bestCash.cashTotal : null)}</div>
      <div class="sub">${bestCash ? esc(bestCash.airlineName || bestCash.airline || '') + ' · ' + fmtDate(bestCash.departDate) + ' → ' + fmtDate(bestCash.returnDate) : 'sem dados'}</div>
    </div>
    <div class="card">
      <div class="label">Menor preço em pontos</div>
      <div class="value">${fmtPoints(bestPoints ? bestPoints.pointsTotal : null)}</div>
      <div class="sub">${bestPoints ? esc(bestPoints.airlineName || bestPoints.airline || '') + ' · ' + fmtDate(bestPoints.departDate) + ' → ' + fmtDate(bestPoints.returnDate) : 'sem dados'}</div>
    </div>
    <div class="card">
      <div class="label">Amostras coletadas</div>
      <div class="value">${analysis.totalSamples}</div>
      <div class="sub">${entries.length ? 'desde ' + fmtDateTime(entries[0].scrapedAt) : 'nenhuma ainda'}</div>
    </div>
  </div>

  <section>
    <h2>Comparação entre companhias</h2>
    <div class="table-scroll">
      <table>
        <thead><tr>
          <th>Companhia</th><th>Menor R$</th><th>Menor pontos</th>
          <th>Valor do ponto /1000</th><th>Custo de compra /1000</th><th>Veredito</th>
        </tr></thead>
        <tbody>${airlineRows(analysis.airlineSummaries)}</tbody>
      </table>
    </div>
  </section>

  <section>
    <h2>Melhor preço em dinheiro por dia</h2>
    ${legend(cashSeries)}
    ${lineChart(cashSeries, { fmtValue: fmtCash, label: 'Menor preço em dinheiro encontrado a cada dia, por companhia' })}
  </section>

  <section>
    <h2>Melhor preço em pontos por dia</h2>
    ${legend(pointsSeries)}
    ${lineChart(pointsSeries, { fmtValue: fmtPoints, label: 'Menor preço em pontos encontrado a cada dia, por companhia' })}
  </section>

  <section>
    <h2>Melhores combinações de data já vistas</h2>
    <div class="table-scroll">
      <table>
        <thead><tr><th>Ida → Volta</th><th>Menor R$</th><th>Menor pontos</th><th>Amostras</th></tr></thead>
        <tbody>${pairRows(analysis.pairSummaries, goodDeals)}</tbody>
      </table>
    </div>
  </section>

  <footer>
    Gerado automaticamente a partir de <code>data/history.json</code>.
    "Bom preço" = pelo menos ${Math.round(cfg.goodDealThreshold * 100)}% abaixo da média histórica da mesma companhia para o mesmo par de datas.
    "Valor do ponto" = quanto de dinheiro cada 1000 pontos evita, comparado ao custo de comprar 1000 pontos
    (esse custo é um valor que você configura em <code>src/config.js</code> — confira se está atualizado).
    Dados coletados por scraping best-effort; podem estar desatualizados ou faltando se o site de origem mudou de layout —
    complemente com <code>npm run add-price</code>.
  </footer>
</div>
</body>
</html>`;
}

module.exports = { render, fmtCash, fmtPoints, fmtDate, fmtDateTime, buildSeries, colorVar, AIRLINE_SLOT };
