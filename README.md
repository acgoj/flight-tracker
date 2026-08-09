# Monitor de passagens Recife → Curitiba

Sistema para acompanhar o preço de passagens aéreas Recife (REC) ↔ Curitiba
(CWB) no fim de ano (ida no fim de dezembro, volta no início de janeiro),
tanto em **dinheiro** quanto em **pontos** (programa TudoAzul), e apontar
quando o preço está bom comparado ao histórico.

## Como funciona

1. Um scraper (`src/scrapers/azul.js`, via Playwright) consulta a busca
   pública de voos da Azul, que mostra o preço em R$ e em pontos TudoAzul
   na mesma tela, sem precisar de login.
2. Cada consulta é salva em `data/history.json` (histórico completo, nunca
   sobrescrito).
3. `scripts/build-dashboard.js` lê o histórico e gera um dashboard estático
   em `docs/index.html`: menor preço em dinheiro, menor preço em pontos,
   valor implícito do ponto, e as melhores combinações de datas já vistas.
4. Um workflow do GitHub Actions (`.github/workflows/track-prices.yml`)
   roda tudo automaticamente 2x por dia e commita os resultados —
   ele roda na infraestrutura do GitHub, com acesso normal à internet.

## ⚠️ Aviso importante sobre o scraper

Este código foi escrito em um ambiente sem acesso à internet real (bloqueado
por proteção anti-bot dos sites de companhias aéreas), então **o scraper não
pôde ser testado contra o site real da Azul antes deste primeiro commit**.
A extração de preços foi feita por padrões de texto (regex sobre "R$ X,XX" e
"X pontos"), que tende a ser mais resistente a mudanças de layout do que
seletores CSS, mas ainda assim precisa ser validada:

1. Depois do primeiro push, rode o workflow manualmente (aba **Actions** →
   *Monitorar precos Recife-Curitiba* → **Run workflow**, marque `quick`
   para ser rápido) e confira o resultado.
2. Se falhar, o job sobe um artefato `debug-scrape-*` com screenshot e HTML
   da página no momento da falha — baixe e veja o que mudou.
3. Ajuste os padrões em `src/scrapers/azul-parser.js` (regex `CASH_RE` /
   `POINTS_RE`) ou os seletores em `src/scrapers/azul.js` (bloco
   `SELECTORS`, usado como plano B se a URL direta não funcionar).

Enquanto isso (ou se o site mudar de novo no futuro), use a entrada manual
como reserva — o dashboard funciona normalmente com dados manuais:

```bash
node scripts/add-price.js --depart 2026-12-20 --return 2027-01-05 \
  --cash 850.30 --points 38000 --points-tax 89.90
```

Também vale lembrar: scraping de sites de companhias aéreas geralmente vai
contra os termos de uso deles. Mantenha a frequência baixa (o workflow já
está configurado para 2x/dia) e desative se a companhia bloquear o acesso.

## Rodando localmente

```bash
npm install
npx playwright install chromium   # baixa o navegador (uma vez)

npm run scrape -- --quick         # consulta só o par de datas padrão
npm run scrape                    # varre as janelas de ida e volta inteiras
npm run scrape -- --debug         # salva screenshot/html em debug/

npm run build-dashboard           # gera docs/index.html a partir do histórico
npm test                          # roda os testes de sanidade (parser, análise, dashboard)

npm run add-price -- --depart 2026-12-20 --return 2027-01-05 --cash 850
```

## Publicando o dashboard (GitHub Pages)

Nas configurações do repositório: **Settings → Pages → Source: Deploy from a
branch**, branch `main` (ou a branch principal), pasta `/docs`. O GitHub
Actions já mantém `docs/index.html` atualizado a cada execução.

## Ajustando a rota e as datas

Tudo fica em `src/config.js`:

- `departureWindow` / `returnWindow`: janelas de data varridas pelo scraper.
- `defaultPair`: par de datas usado no modo `--quick` e como base ao varrer
  cada janela (o scraper fixa uma ponta e varia a outra, para não precisar
  rodar a matriz completa ida × volta).
- `pointsPurchaseCostPer1000`: quanto custa comprar 1000 pontos TudoAzul
  hoje, usado como referência de comparação (atualize quando houver promoção
  de compra de pontos).
- `goodDealThreshold`: quanto abaixo da média histórica um preço precisa
  estar para ser marcado como "bom preço" no dashboard (padrão: 15%).

## Como a comparação dinheiro × pontos funciona

Quando uma mesma busca traz as duas opções (pagar em R$ ou em pontos +
taxas), o sistema calcula o **valor implícito do ponto**:

```
valor por 1000 pontos = (preço em R$ - taxas da opção em pontos) / pontos × 1000
```

Isso é comparado ao custo de comprar pontos avulsos (`pointsPurchaseCostPer1000`)
para saber se vale mais a pena resgatar com pontos, comprar pontos e depois
resgatar, ou simplesmente pagar em dinheiro.

## Estrutura do projeto

```
src/
  config.js              rota, janelas de data, parâmetros de análise
  history.js             leitura/escrita de data/history.json
  analyze.js             menor preço, médias, valor do ponto, "bom preço"
  scrapers/
    azul.js              driver Playwright (navega e coleta o texto da página)
    azul-parser.js        extração de preços a partir do texto (testável)
scripts/
  run-scrape.js          CLI: roda o scraper para as janelas configuradas
  add-price.js           CLI: registro manual de preço
  build-dashboard.js     CLI: gera docs/index.html
  render-dashboard.js    geração do HTML (separado do I/O, testável)
data/history.json        histórico bruto de todas as consultas
docs/index.html           dashboard publicável (gerado, não editar à mão)
test/                     testes de sanidade (sem dependências externas)
.github/workflows/        agendamento via GitHub Actions
```

## Próximos passos possíveis

- Adicionar mais companhias/programas (GOL/Smiles, LATAM/LATAM Pass).
- Alertar por e-mail/Slack quando aparecer um "bom preço" (o workflow já
  identifica isso; falta só o passo de notificação).
- Gráfico separado para o histórico de preço em pontos.
