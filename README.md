# Monitor de passagens Recife → Curitiba

Sistema para acompanhar o preço de passagens aéreas Recife (REC) ↔ Curitiba
(CWB) no fim de ano (ida no fim de dezembro, volta no início de janeiro),
comparando **Azul, GOL e LATAM** tanto em **dinheiro** quanto em **pontos /
milhas**, e apontando quando o preço está bom comparado ao histórico.

## Como funciona

1. Um scraper por companhia (Playwright) consulta a busca pública de voos:
   - **Azul** → preço em R$ e pontos TudoAzul na mesma tela.
   - **GOL** → preço em R$ no site da GOL, milhas no Smiles.
   - **LATAM** → preço em R$ e pontos LATAM Pass em buscas separadas
     (parâmetro `redemption` na URL).
2. Cada consulta é salva em `data/history.json` (histórico completo, nunca
   sobrescrito).
3. `scripts/build-dashboard.js` lê o histórico e gera um dashboard estático
   em `docs/index.html`: comparação entre companhias, menor preço em
   dinheiro e em pontos, valor implícito do ponto e melhores combinações de
   datas.
4. Um workflow do GitHub Actions roda tudo 2x por dia e commita os
   resultados — na infraestrutura do GitHub, com acesso normal à internet.

## ⚠️ Aviso importante sobre os scrapers

Este código foi escrito em um ambiente sem acesso à internet real (os sites
das companhias bloqueiam acesso automatizado de lá), então **nenhum dos três
scrapers foi testado contra o site real**. A extração de preços é feita por
padrões de texto (regex sobre "R$ X,XX" e "X pontos/milhas"), que tende a
ser mais resistente a mudanças de layout do que seletores CSS, mas ainda
assim precisa ser validada na prática.

Grau de confiança, do mais provável de funcionar para o menos:

| Companhia | Dinheiro | Pontos | Observação |
|---|---|---|---|
| Azul | média | média | Dinheiro e pontos vêm da mesma tela |
| LATAM | média | média | Formato de URL bem conhecido (`redemption=true/false`) |
| GOL | baixa | **muito baixa** | URL de compra muda com frequência; **o Smiles normalmente exige login** para mostrar as tabelas boas |

### Status conhecido

A primeira execução real no GitHub Actions (run #1, só com a Azul) falhou
nas 23 consultas com "carregou, mas sem preços" — ou seja, **a conexão
funcionou, mas nenhuma tela de resultado apareceu**. Ainda não sabemos se
foi deep-link errado, SPA lenta ou bloqueio anti-bot; o diagnóstico abaixo
foi construído justamente para responder isso na próxima execução.

### Lendo o diagnóstico

Quando uma consulta falha, a mensagem já diz **qual é o problema**, e o
nome do arquivo em `debug/` carrega a mesma classificação:

| Diagnóstico | Significa | O que fazer |
|---|---|---|
| `bloqueio-anti-bot` | O site recusou acesso automatizado | Não é o código. Comum a partir de IP de datacenter (runners do Actions). Rode local ou use `add-price` |
| `erro-de-rede` | A página nem carregou | Rede, DNS ou bloqueio de saída |
| `carregou-sem-precos` | Página abriu, sem preço nenhum | Deep-link errado (caiu na home), busca sem voos, ou resultados mais lentos que `resultsWaitMs` |
| `formulario-nao-encontrado` | Nenhum seletor de busca bateu | Layout mudou: ajuste `formSelectors` do módulo |

Se três consultas seguidas da mesma companhia falharem pelo mesmo motivo
estrutural, o scraper **aborta aquela companhia** e pula o resto — não
adianta insistir, e martelar um site que já recusou o acesso é má prática.

Como validar/consertar:

1. Aba **Actions** → *Monitorar precos Recife-Curitiba* → **Run workflow**,
   marcando `quick` e escolhendo uma companhia, para isolar.
2. Leia o diagnóstico no log — na maioria dos casos ele já basta.
3. Se precisar do HTML, o job sobe um artefato `debug-scrape-*` com
   screenshot e HTML da página no momento da falha.
4. Ajuste o módulo da companhia em `src/scrapers/` (URL e seletores) ou os
   padrões em `src/scrapers/fare-parser.js`.

Uma companhia quebrada **não derruba as outras**: cada consulta falha
isoladamente e o resumo no fim da execução diz qual companhia não retornou
nada.

Enquanto isso, a entrada manual funciona como reserva — o dashboard trata
dados manuais igual aos coletados:

```bash
npm run add-price -- --airline gol --depart 2026-12-20 --return 2027-01-05 \
  --cash 912.40 --points 41000 --points-tax 94.20
```

Também vale lembrar: scraping de sites de companhias aéreas geralmente vai
contra os termos de uso deles. Mantenha a frequência baixa (o workflow já
está em 2x/dia) e desative a companhia no config se ela bloquear o acesso.

## Rodando localmente

```bash
npm install
npx playwright install chromium      # baixa o navegador (uma vez)

npm run scrape                        # todas as cias, janelas completas
npm run scrape -- --quick             # só o par de datas padrão
npm run scrape -- --airline=latam     # só uma companhia
npm run scrape -- --quick --debug     # salva screenshot/html em debug/

npm run build-dashboard               # gera docs/index.html
npm test                              # testes de sanidade
```

## Publicando o dashboard (GitHub Pages)

**Settings → Pages → Source: Deploy from a branch**, branch `main`, pasta
`/docs`. O Actions mantém `docs/index.html` atualizado a cada execução.

## Ajustando rota, datas e companhias

Tudo em `src/config.js`:

- `departureWindow` / `returnWindow`: janelas de data varridas.
- `defaultPair`: par usado no modo `--quick` e como base ao varrer cada
  janela (o scraper fixa uma ponta e varia a outra, em vez de rodar a
  matriz completa ida × volta, que seria lenta demais).
- `airlines`: quais companhias monitorar (`enabled: false` desliga uma) e o
  custo de compra de pontos de cada programa.
- `goodDealThreshold`: quanto abaixo da média histórica um preço precisa
  estar para ser marcado como "bom preço" (padrão: 15%).

> **Os valores de `pointsPurchaseCostPer1000` são placeholders.** O preço de
> compra de pontos muda o tempo todo e despenca em promoção. Atualize com o
> valor real antes de confiar na coluna "veredito" do dashboard.

## Como a comparação dinheiro × pontos funciona

Quando uma mesma busca traz as duas opções, o sistema calcula o **valor
implícito do ponto**:

```
valor por 1000 pontos = (preço em R$ - taxas da opção em pontos) / pontos × 1000
```

Se esse valor for **maior** que o custo de comprar 1000 pontos, resgatar
compensa; se for menor, sai mais barato pagar em dinheiro. É isso que a
coluna "veredito" mostra.

## Adicionando uma companhia nova

Cada companhia é um módulo declarativo pequeno — toda a mecânica de
navegador, fallback e parsing mora em `src/scrapers/base.js`:

```js
// src/scrapers/minhacia.js
module.exports = {
  id: 'minhacia',
  name: 'Minha Cia',
  loyaltyProgram: 'Programa X',
  homeUrl: 'https://...',
  buildCashUrl(cfg, departDate, returnDate) { return 'https://...'; },
  buildPointsUrl(cfg, departDate, returnDate) { return 'https://...'; }, // opcional
  formSelectors: { /* plano B, se a URL direta não funcionar */ },
};
```

Depois registre em `src/scrapers/index.js`, adicione em `config.airlines`,
e dê uma cor a ela em `AIRLINE_SLOT` (`scripts/render-dashboard.js`).

## Estrutura do projeto

```
src/
  config.js                rota, janelas de data, companhias, parâmetros
  history.js               leitura/escrita de data/history.json
  analyze.js               menor preço, médias, valor do ponto, "bom preço"
  scrapers/
    index.js               registro das companhias
    base.js                navegador + fluxo comum (URL → fallback → parsing)
    fare-parser.js         extração de preços a partir do texto (testável)
    azul.js / gol.js / latam.js   definições por companhia
scripts/
  run-scrape.js            CLI: roda os scrapers
  add-price.js             CLI: registro manual
  build-dashboard.js       CLI: gera docs/index.html
  render-dashboard.js      geração do HTML (separado do I/O, testável)
data/history.json          histórico bruto de todas as consultas
docs/index.html            dashboard publicável (gerado, não editar à mão)
test/                      testes de sanidade + fixtures das 3 companhias
```

## Próximos passos possíveis

- Notificar por e-mail/Slack quando aparecer um "bom preço" (a detecção já
  existe; falta só o passo de notificação).
- Buscar preços de agregadores (Google Flights, Kayak) como referência
  cruzada.
- Considerar voos com origem/destino alternativos (ex.: sair de outro
  aeroporto do Nordeste) quando a diferença compensar.
