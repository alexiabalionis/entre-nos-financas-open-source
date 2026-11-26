# Handover — Aprovação de movimentos do banco em Mês/Movimentos

Data: 2026-11-07 · Autoria: Aléxia + Kiro
Para: próximo agente que continuar esta feature.

Este documento é auto-suficiente. NÃO delega leitura das fontes: traz o estado
real do disco, as decisões já fechadas, o que foi feito e verificado, e o próximo
passo com critério de aceite. A spec completa está em
`docs/SPEC-APROVACAO-MOVIMENTOS.md` (escopo B: aprovar inline + fatura/projeção).

## Contexto do projeto (1 parágrafo)

`entre-nos-financas-open-source` é um app Next.js 16 de finanças de casal. Banco
embutido PGlite (Postgres em WASM, datadir `data/postgres/`, sem Postgres
externo em modo local). `DATABASE_URL` ausente = PGlite local. A leitura do banco
conectado (Pluggy) deixa movimentos como `bank_transactions` status `pending`,
que só viram lançamento (`economic_events`) após aprovação explícita — por design
(evita duplicata, transferência-virando-gasto, previsto≠confirmado).

## REGRA CRÍTICA DE OPERAÇÃO (não repetir o incidente)

PGlite é single-writer por datadir. NUNCA abrir `data/postgres` por um segundo
processo (script `new PGlite(...)` apontando pro datadir do app, `pg_ctl` nativo),
NEM com o server parado. Isso corrompe os arquivos de forma irrecuperável
(`RuntimeError: Aborted()` ao montar; Postgres nativo rejeita por
`USE_FLOAT8_BYVAL`). Já aconteceu nesta feature: scripts de inspeção
(`_peek-banks.mjs`) corromperam o banco de teste, que teve de ser recriado.
- Inspecionar dados: só pela API do app com o server VIVO, ou via `npm run backup`.
- `npm run backup` ANTES de qualquer teste que escreve no banco (hoje não há
  backup automático; sem ele, corrupção = perda total).

## O que JÁ foi feito e verificado (no disco agora)

Gate `npm run typecheck` = 0 e `npm run lint` = 0 (limpos) no último estado.
Arquivos modificados (não commitados) + 2 docs novos. `git status` deve mostrar:
`app/api/[...path]/route.ts`, `app/family-banks.tsx`, `app/family-movements.tsx`,
`app/family.tsx`, `src/domain/movements.ts`, `src/server/api-policy.ts`,
`src/server/banks.ts`, `src/server/state.ts`, `docs/SPEC-*.md`, `docs/HANDOVER-*.md`.
(`next-env.d.ts` é gerado pelo Next, ignore.)

### Fase 1 — pendências do banco aparecem em Movimentos ✅
- `src/server/state.ts`: `readState` retorna `state.bankPending` — os
  `bank_transactions` `pending` do mês/moeda da tela, com `id`, `version`,
  `group` (de `analysis`), `duplicate`, `blocked` (provisório/alterado/sumido).
  Totais não mudam.
- `src/domain/movements.ts`: tipo `Movement` ganhou `source?: "import" | "bank"`
  e `blocked?`.
- `app/family-movements.tsx`: soma `state.bankPending` ao filtro "A conferir",
  com rótulo "Do banco · a conferir" e, se bloqueado, "Provisório no banco".
- Confirmado em tela pela usuária: aparece.

### Fase 2 — aprovar/rejeitar inline ✅ (com 1 ponto a validar, abaixo)
- `app/family-movements.tsx`: item pendente de banco (`source==="bank"`,
  `!blocked`) expandido mostra:
  - **Confirmar** para grupo `income`/`expense` → `POST banks/review`
    `{id, version, decision:"record", kind}`.
  - **Rejeitar** → `decision:"ignore"` com nota (mín. 8 chars).
  - Outros grupos (transfer/duplicata/unclear) → orientação pra concluir em
    Perfil → Bancos (forms complexos NÃO foram duplicados; reusam o painel
    existente).
  - `postApi()` helper + estados `busy/actionError/actionNotice`; `refresh`
    (= `load` do pai) recarrega após a ação.
- `app/family.tsx`: passa `refresh={load}` e `month={month}` ao `MovementsPanel`.
- `app/api/[...path]/route.ts` + `src/server/api-policy.ts`: rota
  `banks/review-batch` (lote "simples do mês", de `reviewBankBatch`) registrada
  na allowlist de writes. (Botão de lote original no painel Bancos:
  `reviewBankBatch` em `banks.ts` — a spec previa incorporá-lo à aba Movimentos;
  isso ainda NÃO foi feito, ver pendências.)

### Sugestão automática de categoria ✅
- `src/server/banks.ts`: em `reviewBankTransaction`, quando `decision:"record"`
  e sem `category_id` e kind `expense`/`income`, deriva a categoria pela
  descrição com `categoryFor()` (importado de `./assisted.ts` — o MESMO
  categorizador do import de arquivo, regex → "Supermercado e feira",
  "Transporte", "Saúde" etc.), faz upsert em `categories` (ON CONFLICT DO
  NOTHING) e registra com ela. Sem match → "Outras despesas". Decisão: NÃO usar
  a categoria que a Pluggy manda (vem em inglês, sem mapa pras categorias do
  app); `categoryFor` já resolve pro vocabulário do app.
- Sem ciclo de import: `assisted.ts` não importa `banks.ts` (verificado).

## O que NÃO foi validado em runtime (VALIDAR PRIMEIRO)

O banco foi recriado do zero após a corrupção. As Fases 1/2 passaram no gate
(typecheck+lint) mas o fluxo de **Confirmar/Rejeitar end-to-end** só foi exercido
contra o banco que corrompeu. No banco novo:
1. Reconectar o Pluggy e reler os movimentos (Perfil → Bancos → Ler atualização).
2. Em Movimentos → mês com pendências → "A conferir", clicar numa despesa do
   banco e tocar **Confirmar**.
   - Aceite: cria 1 `economic_event`, o item sai de pending, passa a contar nos
     totais, e vem categorizado pela sugestão (ex.: "UBER" → Transporte).
   - Se der 400 `security.input_rejected`: checar que o acesso é por
     `http://localhost:3210` ou `127.0.0.1:3210` (o `assertLocal` em
     `src/server/http.ts` recusa write de outro host/origin — ex.: IP da LAN).
3. **Rejeitar** com nota ≥ 8 chars → item vira `ignored`, fora dos totais.

## Pendências / próximos passos (ordem sugerida)

1. **Validar Fase 2 em runtime** no banco novo (acima). É o gate pra seguir.
2. **Incorporar o lote à aba Movimentos** (decisão 3 da spec): expor
   `banks/review-batch` como botão "Aprovar simples do mês" EM Movimentos e
   remover o botão escondido no painel Bancos (`app/family-banks.tsx`). Hoje a
   rota existe mas o botão ainda está no painel Bancos.
3. **Fase 3 — fatura e projeção** (a maior; decisões já fechadas na spec):
   - Fatura pesa no mês do VENCIMENTO.
   - Parcelas projetam nos meses subsequentes (projeção, fora dos totais até
     aprovar a fatura do mês).
   - Projeção consolidada na aba FUTURO; resumo da fatura do mês na aba Mês.
   - Reusar infra existente: `card_cycles` (013, fechamento/vencimento),
     `bank_card_bills` (011), `bank_transactions.card_meta` (`bill_id`,
     `installment_number`, `purchase_date` — já liga compra→fatura).
   - Aprovar fatura = 1 `card_payment` na conta pagadora, data no vencimento.
   - Aceites AC3.1–AC3.5 na spec.

## Regras do projeto a respeitar (gate)

- Verificação: `npm run typecheck` (tsc --noEmit) E `npm run lint`
  (`eslint ... --max-warnings=0`) — ambos devem passar antes de declarar pronto.
  Sem framework de teste no projeto (não existe `npm test`).
- Dev: `npm run dev` (recompila a cada save). `npm start` serve build
  pré-compilado — NÃO reflete edições sem `npm run build` antes (tropeçamos nisso
  várias vezes; use `dev` ao iterar).
- Subagents desta instalação NÃO alcançam `~/projects` (workspace isolado) — não
  delegar edição deste repo a subagent; fazer no agente principal.
- Nada commitado ainda: são mudanças num repo open-source de terceiros; a usuária
  decide o commit.
