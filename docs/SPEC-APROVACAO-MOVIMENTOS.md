# Spec — Aprovar/rejeitar movimentos do banco na aba Mês/Movimentos + fatura e projeção

Status: implementado, aguardando validação em runtime. Fase 1 ✅ · Fase 2 ✅
(lote incorporado à aba Movimentos) · Fase 3 ✅ no modelo final (Mundo B, sem
aprovação de fatura, Forma 2): ciclo pré-preenchido, projeção na aba Futuro,
resumo no Mês, compra conta por categoria no vencimento, divergência explicada,
selo do cartão na timeline, sinalização de cartão sem ciclo. Gate limpo. Falta
validar end-to-end na tela com os dados reais.
Autoria: Aléxia + Kiro
Data: 2026-11-07

## Por que isso existe (motivação de negócio)

Hoje a leitura do banco conectado (Pluggy) deixa os movimentos numa fila de
revisão **escondida no painel Perfil → Bancos**, e a pessoa precisa abrir cada
um e preencher a finalidade. Na primeira leitura isso vira dezenas de itens a
revisar um a um, num lugar que a pessoa nem associa a "ver meus gastos". A dona
do dinheiro pensa em **mês** e em **movimentos**, não em "fila de conciliação
bancária". A fricção atual faz ela achar que o app está quebrado ("li e não
aparece nada").

Ao mesmo tempo, o passo de aprovação **não é burocracia à toa** — ele existe
para três proteções reais que não podem ser perdidas:

1. **Duplicata.** O mesmo gasto pode chegar pelo banco E por um extrato
   PDF/CSV importado. Registrar sem conferir dobraria o lançamento.
2. **Transferência não é gasto.** Transferência entre contas próprias e
   pagamento de fatura precisam da conta de destino; contá-los como despesa
   infla os totais e mente para o casal.
3. **Previsto ≠ confirmado.** Compras de cartão e faturas futuras são
   provisórias; entram nos totais só quando realmente acontecem.

**Objetivo desta spec:** trazer a aprovação para onde a pessoa já olha (aba
Mês/Movimentos), tornar a aprovação rápida (individual, em lote e por fatura),
**sem** abrir mão das três proteções acima, e dar visão do **futuro das faturas**
para o casal se planejar.

## O problema concreto que motivou (caso real)

Primeira leitura de uma conta Itaú via Pluggy trouxe 95 movimentos:
- 23 de conta corrente (`POSTED`: 14 despesas simples + 7 "a decidir" + 2 já
  registrados; 5 ainda `PENDING` no banco).
- 67 de cartão (`PERSONNALITE MULT BLACK`), **todos `PENDING`**, com datas de
  fatura espalhadas até set/2027.

Dois sintomas que a spec resolve:
- Os de conta corrente POSTED **deveriam** aparecer na aba Movimentos e não
  aparecem, porque a aba só lê `staged_transactions` (import de arquivo), não
  `bank_transactions` (banco conectado). São fontes separadas.
- O cartão é provisório e espalhado no futuro; aprovar compra a compra é
  inviável e sem sentido. A pessoa quer **ver a projeção da fatura** e aprovar
  por fatura.

## Estado atual do código (fonte da verdade, lido em 2026-11-07)

- `src/server/banks.ts`
  - `reviewBankTransaction(db, u, {id, version, decision, kind, ...})` —
    registra UM `bank_transactions` como lançamento. `decision`:
    `link | record | ignore | refresh`. Bloqueia registro se
    `provider_status !== 'POSTED'`, `changed` ou `missing`. Cartão exige
    diferenciar compra/pagamento/estorno; `card_payment` exige
    `counter_account_id`. Trava anti-duplicata via `candidates()`.
  - `reviewBankBatch(db, u, {month, currency})` — já criado nesta iteração;
    registra em lote os `income`/`expense` POSTED de conta corrente do mês.
    **Será incorporado** (ver Decisões).
  - `readBanks()` — monta a fila de revisão (grupos de `analyzeObservations`,
    paginação de 30), hoje consumida só pelo painel Bancos.
- `src/domain/bank-analysis.ts` — `analyzeObservations()` classifica cada
  movimento num `group`: `income | expense | transfer | card | investment |
  duplicate | history | statement | unclear | pending`.
- `src/server/state.ts` — `readState()` devolve `state.bankRows` **de
  `staged_transactions`** (import de arquivo), com `recorded`, `duplicate_hint`,
  `event_kind`. É o que a aba Movimentos já exibe no filtro "A conferir".
- `app/family-movements.tsx` — aba Movimentos. Já mistura `state.events`
  (confirmados) + `state.bankRows` pendentes de import, com filtro "A conferir",
  badge de contagem, marca de duplicata. **Item pendente só expande detalhe,
  sem ação.**
- Infra de cartão já existente (reusar, não recriar):
  - `card_cycles` (013) — `closing_day`, `due_day`, `due_month_offset`,
    `effective_close_date`, `effective_due_date` por conta. Ciclo configurável
    já modelado.
  - `bank_card_bills` (011) — faturas lidas do banco: `due_date`, `close_date`,
    `total_cents`, `charges_cents`, `payments`.
  - `bank_accounts.credit_due_date` / `credit_close_date` / `credit_limit_cents`.
  - `bank_transactions.card_meta` (jsonb): `bill_id`, `installment_number`,
    `total_installments`, `purchase_date` — **já liga cada compra à fatura**.
  - `manual_card_settings` / `manual_card_bills` (014) — cartão manual.

## Decisões fechadas (não reinterpretar)

1. **Fonte unificada na aba Movimentos.** A aba passa a exibir pendências das
   DUAS fontes: `staged_transactions` (import) e `bank_transactions` (banco).
   `readState` ganha um segundo conjunto `state.bankPending` vindo de
   `bank_transactions` com o mesmo shape de linha de movimento (campos:
   `id`, `date`, `description`, `account`, `amount`, `event_kind` sugerido pelo
   grupo da análise, `review: true`, `source: 'bank'`, `duplicate`, `group`,
   `blocked`, `blocked_reason`).
2. **Aprovar/rejeitar inline.** Um item pendente expandido ganha ações:
   **Aprovar** (registra reusando `reviewBankTransaction` decision=`record`),
   **Vincular** (decision=`link`, quando há candidato), **Rejeitar/Ignorar**
   (decision=`ignore`, com justificativa). Nenhuma lógica nova de registro —
   só superfície de UI chamando a função que já existe.
3. **Aprovar em lote vira "aprovar os selecionados do mês".** O botão de lote do
   painel Bancos (`reviewBankBatch`) é **incorporado** à aba Movimentos como
   "Aprovar simples do mês" e o botão escondido no painel Bancos é removido.
   Escopo do lote permanece o seguro: só `income`/`expense` POSTED de conta
   corrente, sem candidato de duplicata.
4. **Cartão NÃO entra no lote simples nem é aprovado compra a compra.** Cartão é
   tratado por **fatura** (ver Fase 3). Compra de cartão provisória
   (`PENDING`/futura) permanece bloqueada para registro individual; aparece
   somente na projeção.
5. **Rejeitar = `ignore` existente.** Não há delete. Rejeitar marca
   `status='ignored'` com nota (o schema já exige nota ≥ 8 chars no `ignore`).
   Reversível: um `ignored` pode voltar a `pending` numa releitura do banco.
6. **Totais intocados até aprovação.** Item pendente (qualquer fonte) nunca
   entra nos totais do mês antes de virar `recorded`/`linked`. Regra atual
   preservada.

## Fases (cada uma entregável e testável de forma independente)

### Fase 1 — Pendências do banco aparecem na aba Movimentos (sem ação ainda) ✅ IMPLEMENTADA

**O que muda:** `readState` passa a trazer `state.bankPending` de
`bank_transactions` (status `pending`, moeda e mês da tela, com `group`,
`blocked`, `blocked_reason` derivados). A aba Movimentos passa a somar essas
linhas às de import no filtro "A conferir", distinguindo a fonte com um rótulo
("do banco" vs "do extrato").

**O que o usuário vê:** abrindo o mês, os movimentos do banco daquele mês
aparecem em "A conferir", fora dos totais, cada um com sua situação (ex.: "Ainda
provisório no banco — não pode ser registrado").

**Aceite (testável):**
- AC1.1 Com N `bank_transactions` `pending` POSTED no mês X, a aba Movimentos no
  mês X, filtro "A conferir", lista exatamente essas N linhas + as de import.
- AC1.2 Um `pending` com `provider_status<>'POSTED'` aparece com rótulo
  "provisório" e **sem** botão de aprovar.
- AC1.3 Totais do mês não mudam ao abrir a aba (nenhum lançamento criado).
- AC1.4 `npm run typecheck` e `npm run lint` limpos.

### Fase 2 — Aprovar/rejeitar inline + lote na aba Movimentos ✅ IMPLEMENTADA

**O que muda:** item pendente de banco expandido mostra ações conforme o grupo:
- `expense`/`income` POSTED conta corrente → botão **Aprovar** (record) e
  **Rejeitar** (ignore com nota).
- grupo com candidato (`history`/`statement`/`duplicate`) → botão **Vincular ao
  existente** (link) + **Registrar assim mesmo** (record com justificativa) +
  **Rejeitar**.
- `transfer` → pede a conta de destino antes de aprovar (reusa o form atual).
- `unclear` → seletor de finalidade + categoria, depois Aprovar.
- Botão de topo **"Aprovar simples do mês"** (ex-`reviewBankBatch`) e
  **"Rejeitar selecionados"**.

**Por que assim:** cada ação chama a MESMA `reviewBankTransaction`, então todas
as travas (duplicata, moeda, versão, cartão) continuam valendo item a item; a UI
só expõe o que a função já permite. Zero caminho novo de escrita.

**Aceite (testável):**
- AC2.1 Aprovar um `expense` POSTED cria 1 `economic_event`, move o item para
  `recorded`, e ele passa a contar nos totais do mês.
- AC2.2 Rejeitar exige nota ≥ 8 chars; sem nota, bloqueia com erro inline.
- AC2.3 Aprovar um item com candidato de duplicata, sem escolher vincular nem
  justificar distinção, é recusado com a mensagem de duplicidade atual.
- AC2.4 "Aprovar simples do mês" registra só `income`/`expense` POSTED de conta
  corrente e informa "registrados X, pulados Y"; cartão/transfer/duplicata não
  entram.
- AC2.5 Aprovar um `pending` não-POSTED é impossível pela UI (botão ausente) e,
  se forçado via API, retorna o erro de "aguarde a confirmação do banco".

### Fase 3 — Fatura de cartão: configuração, agrupamento e projeção futura 🔶 EM ANDAMENTO

**O que muda:**
- **Configurar o ciclo** por cartão reusando `card_cycles` (dia de fechamento,
  dia de vencimento, offset do mês de vencimento). UI na conta do cartão.
  **Pré-preenchido pelo banco (Opção A, implementado 2026-11-07):** quando ainda
  não há ciclo salvo e a leitura trouxe `credit_due_date`, o form já abre
  preenchido — vencimento = data da Pluggy; fechamento = `credit_close_date`
  quando o banco manda, senão **vencimento − 10 dias** (estimado, com aviso). A
  pessoa confere e salva com 1 toque; nada grava sozinho (continua passando pelo
  `POST /api/cards/cycle`, que valida `due_date > close_date` e offset 0/1).
- **Agrupar compras por fatura** usando `card_meta.bill_id` (quando o banco
  fornece) ou, na ausência, pelo ciclo configurado (data da compra → janela de
  fechamento → fatura correspondente).
- **Projeção futura:** uma visão (card no Mês ou aba Futuro) que mostra, por
  cartão, as faturas em aberto e futuras com total previsto (soma das compras
  agrupadas + `bank_card_bills.total_cents` quando lido), data de vencimento, e
  marca de "provisório" para compras ainda `PENDING`.
- **SEM aprovação de fatura (revisto 2026-11-07, decisão da Aléxia).** A fatura
  já é um fato do banco; não existe passo de "aprovar fatura". O cartão sai da
  fila de "a conferir". Cada compra da fatura **pesa no mês do vencimento
  automaticamente, na sua categoria** (Mundo B, decisão 7).

**Por que assim (motivação):** o casal raciocina por fatura, e a fatura não é
uma previsão incerta — é um valor que o banco já fechou. Forçar aprovar seria
fricção sem ganho (diferente da conta corrente, onde aprovar protege contra
duplicata e transferência-virando-gasto). O que importa é só QUANDO o gasto
entra no orçamento (no vencimento) e PODER ver onde o dinheiro foi (cada compra
com sua categoria).

**Decisões da Fase 3 (fechadas em 2026-11-07):**

1. **As compras da fatura pesam no mês do VENCIMENTO, cada uma na sua
   categoria.** O impacto no orçamento acontece no mês em que a fatura vence
   (não no fechamento), automaticamente, sem aprovação. Não é "um valor só" (ver
   decisão 7, Mundo B): são as compras individuais, deslocadas da data da compra
   para o mês de vencimento da fatura, cada uma contando na sua categoria.
   Motivação: é quando o dinheiro de fato sai da conta corrente; é o mês em que
   o casal precisa ter o saldo. Uma compra feita em dezembro numa fatura que
   vence em janeiro pesa no orçamento de janeiro.
2. **Parcelas projetam para os meses subsequentes como visão, não como
   confirmação.** Uma compra parcelada (`installment_number`/`total_installments`
   do `card_meta`) aparece no mês de vencimento da fatura correspondente, para
   dar visibilidade do comprometimento futuro. Confirmado no dado real
   (2026-11-07): o cartão da Aléxia é **Padrão A** da Pluggy (posta todas as
   parcelas de uma vez, cada uma com a data do mês de vencimento), então as
   parcelas futuras JÁ existem como `bank_transactions` com data futura — a
   projeção não é estimativa cega, é agrupamento de dado real pelo ciclo. Elas
   ficam fora dos totais confirmados até o mês de vencimento chegar (quando a
   fatura daquele mês passa a pesar, decisão 1).
3. **Projeção consolidada na aba FUTURO; resumo leve na aba Mês.** A lista
   completa de faturas em aberto e futuras (todos os cartões, meses
   subsequentes) vive na aba **Futuro**, que é a visão de planejamento de longo
   prazo. A aba **Mês** mostra só um resumo da fatura que vence naquele mês.
   Motivação: o pedido é "visibilidade das parcelas nos meses subsequentes" —
   uma tela única consolidada atende isso; o Mês fica com o contexto do mês
   corrente sem virar uma lista de futuro.
4. **Ciclo pré-preenchido pelo banco, pessoa confirma (Opção A).** Para a
   projeção começar sem fricção, o passo manual de informar fechamento e
   vencimento é pré-preenchido com o que a Pluggy retorna na leitura
   (`credit_due_date`/`credit_close_date` já persistidos em `bank_accounts`).
   Quando o banco não manda o fechamento (observado no payload real do
   PERSONNALITE MULT BLACK: `balanceCloseDate: null`), estima-se **vencimento −
   10 dias** e avisa que é estimativa. Motivação: no caso feliz a projeção vira
   "confirmar", não "digitar"; a pessoa mantém o controle (datas de fechamento
   erradas bagunçam o agrupamento por fatura, então não se grava sozinho). NÃO
   se deriva o ciclo por regra fixa sem confirmação — inferir fechamento
   silenciosamente somaria compras no mês errado.
5. **Agrupamento por fatura: banco quando tem `bill_id`, ciclo no resto
   (Caminho 1, fechado 2026-11-07).** Para cada mês futuro, o total previsto da
   fatura vem de duas fontes, nesta ordem:
   - **Banco (confiável):** compras com `card_meta.bill_id` preenchido são
     somadas pela fatura que a Pluggy já atribuiu. É o caso real do Black, que
     traz `bill_id` de compras parceladas até 2027. A fatura mostra o rótulo
     "informado pelo banco".
   - **Ciclo (estimado):** compras SEM `bill_id` caem na fatura pela data da
     compra dentro da janela de fechamento do `card_cycles` configurado. A
     fatura mostra "estimado pelo ciclo".
   - Uma mesma fatura futura pode misturar as duas (parte confirmada pelo banco,
     parte estimada); o rótulo então é "parcial: X informado, Y estimado".
   Motivação: o cartão real já carrega a verdade do banco para meses futuros;
   ignorá-la e estimar tudo pelo ciclo jogaria fora dado confiável. O ciclo só
   preenche o que o banco ainda não atribuiu.
6. **Horizonte: até a última fatura conhecida (fechado 2026-11-07).** A projeção
   vai do mês corrente até o mês de vencimento da **última** fatura com
   evidência — a maior data entre: o maior `due_date` de `bank_card_bills`, e o
   vencimento da fatura da compra parcelada mais distante (maior
   `card_meta.bill_id`/data de vencimento derivada). Sem limite fixo de meses.
   Motivação: parcelas longas (o Black vai a 2027) precisam aparecer inteiras;
   um corte em 12 meses esconderia comprometimento real que o banco já afirma.
   Guarda-chuva de segurança: se não houver NENHUMA evidência futura (sem
   `bill_id`, sem bills), a projeção cobre só o ciclo do mês corrente (AC3.1),
   não inventa meses.
7. **Mundo B: cada COMPRA conta na sua categoria; o PAGAMENTO da fatura é
   neutro (fechado 2026-11-07, revisto após decisão da Aléxia).** O orçamento
   por categoria deve enxergar cada compra de cartão — então cada compra é um
   gasto real (`card_purchase`), na sua categoria, pesando no **mês de
   vencimento** da fatura que a contém (decisão 1 / eixo de competência, decisão
   10), não no mês da compra. A fatura NÃO é um gasto: é a transferência que
   quita a dívida do cartão
   (`card_payment`, conta corrente → cartão). O único problema a resolver era a
   duplicação, e ela JÁ é resolvida pelo modelo contábil do app: em
   `src/domain/finance.ts`, `economicEffect` conta `card_purchase` como
   `expense` e trata `card_payment` como neutro (`{income:0, expense:0}`),
   pareado cartão↔conta. Logo, o consumo conta uma vez (na compra/categoria) e o
   pagamento só move dinheiro pra quitar, sem duplicar. Motivação: a Aléxia quer
   o orçamento por categoria vendo o cartão; só não pode contar o mesmo dinheiro
   duas vezes.
8. **NUNCA zerar/anular o valor de uma compra.** O valor é o fato (R$ 320 no
   mercado) e é ele que alimenta o orçamento da categoria (decisão 7). Zerar
   destruiria o próprio gasto que deve contar, é irreversível e fere a regra do
   projeto (nunca converter valor em null em silêncio, nunca deletar o fato). A
   não-duplicação vem do PAPEL do lançamento (compra=despesa, pagamento=neutro),
   nunca de apagar valor.
9. **Compras aparecem na TIMELINE do mês, na data da compra (fechado
   2026-11-07).** As compras de cartão não ficam escondidas atrás de um expand
   do cartão: aparecem na ordem cronológica do mês, cada uma na sua data,
   misturadas aos demais movimentos, com um cabeçalho pequeno/light indicando o
   cartão (ex.: "· Black"). Ficam na data da COMPRA (mês em que aconteceu), não
   no mês do vencimento. Quando uma compra entra na fatura de um mês seguinte,
   isso é sinalizado VISUALMENTE (pendência: desenhar esse selo depois), sem
   mudar a data. Motivação: "ver onde o dinheiro foi" é cronológico; a fatura é
   o que pesa no orçamento, a compra é o detalhe de onde foi.
10. **Dois eixos por compra de cartão + Forma 2 (derivar na soma), sem migration
    (fechado 2026-11-07).** Uma compra de cartão tem dois "meses" distintos e
    intencionais:
    - **Exibição (timeline):** `transaction_date` = dia da compra (decisão 9).
    - **Competência (orçamento/totais):** mês de **vencimento** da fatura que a
      contém. Para compra com `bill_id` real, vem de `bank_card_bills.due_date`;
      para PENDING sem `bill_id`, é o `cardCyclePeriod(...).due_date` **derivado
      do ciclo** configurado.
    **Forma 2 escolhida:** NÃO materializamos um `economic_event` por compra nem
    adicionamos coluna. A compra fica em `bank_transactions` (fonte da verdade
    que o banco atualiza) e o `src/server/state.ts` passa a SOMAR, no `expense`
    e no `spending` por categoria do mês, as compras de cartão PENDING cujo
    vencimento derivado cai naquele mês. Categoria pela descrição via
    `categoryFor` (automática), computada na soma. `card_payment` segue neutro
    (decisão 7) → sem duplicação. Conta mesmo PENDING (não espera pagar).
    Trade-off aceito: a categoria automática não é corrigível pela pessoa (não é
    persistida) — se precisar corrigir, migra-se para a Forma 1 (materializar
    evento) depois.
11. **Sem ciclo configurado → FORA do orçamento, COM sinalização (fechado
    2026-11-07).** Se o cartão não tem `card_cycles`, não dá para derivar o mês
    de vencimento; a compra NÃO entra no orçamento de nenhum mês (não cai no
    `transaction_date` como fallback — isso contaria no mês errado em silêncio).
    A tela sinaliza: "configure o fechamento/vencimento deste cartão para estas
    compras entrarem no orçamento do mês". Com o ciclo pré-preenchido (decisão
    4), configurar é 1 toque. Motivação: contar no mês errado corrompe o
    orçamento sem avisar; melhor ficar de fora e pedir o passo que falta.

**Aceite (testável):**
- AC3.1 Configurar fechamento/vencimento grava em `card_cycles` e a projeção
  passa a agrupar pelas datas configuradas.
  - ✅ **Implementado (2026-11-07):** o form de ciclo pré-preenche com o banco
    (vencimento da Pluggy; fechamento do banco ou vencimento − 10 dias) e, ao
    salvar, a projeção agrupa pelas datas configuradas. A projeção futura
    multi-mês foi feita em AC3.2.
- AC3.2 A aba Futuro mostra, por cartão, a fatura atual + as futuras **até a
  última fatura conhecida** (decisão 6), cada uma no seu mês de vencimento, com
  total previsto e rótulo de origem ("informado pelo banco" / "estimado pelo
  ciclo" / "parcial", conforme decisão 5); compras `PENDING` e parcelas futuras
  marcadas como provisórias (fora dos totais).
  - ✅ **Implementado (2026-11-07):** backend `readCardProjection` em
    `src/server/cards.ts` (rota GET `cards/projection?month=`, reusa
    `cardCyclePeriod`/`shiftMonth`, agrupa por mês de vencimento derivado do
    banco via `card_meta.bill_id`+`bank_card_bills.due_date` e, no resto, pelo
    ciclo; horizonte do mês corrente até a última fatura conhecida). Frontend:
    seção "Faturas futuras" na `FuturePanel` (`app/family-extras.tsx`), só BRL,
    com rótulo de origem e marca de provisório por fatura. Gate typecheck+lint
    limpo. **Falta validar em runtime** com as compras reais do Black.
- AC3.3 A aba Mês mostra, no mês M, o resumo da fatura que VENCE em M (total
  previsto + data), sem listar as futuras.
  - ✅ **Implementado (2026-11-07):** `CardsPanel` (`app/family-cards.tsx`)
    busca `cards/projection?month=` e, em cada cartão, mostra "Fatura que vence
    neste mês" filtrando `due_month === month`, com total, rótulo de origem e
    marca de provisório. Não lista as futuras (essas ficam na aba Futuro).
    Gate limpo. Falta validar em runtime.
- AC3.4 (Mundo B — compra conta por categoria no vencimento, Forma 2) No mês M,
  cada compra de cartão cuja fatura VENCE em M pesa no orçamento de M, na SUA
  categoria (não "um valor só"; cada compra conta). O pagamento da fatura é
  neutro (`card_payment`), então não há duplicação. Sem aprovação.
  - ✅ **Implementado (2026-11-07):** `src/server/state.ts` soma as compras de
    cartão PENDING cujo vencimento derivado do ciclo cai em M, no `expense` e no
    `spending` por categoria (categoria via `categoryFor`; sem match →
    `uncategorized`). Janela curta de 3 meses de `transaction_date`. Helper
    `dueMonthFromCycle` compartilhado com a projeção (`cards.ts`), sem duplicar a
    regra. Anti-duplicação garantida por `economicEffect` (`card_payment`
    neutro) + filtro `event_id IS NULL`. Cartão sem ciclo fica de fora
    (decisão 11), exposto em `state.cardBudgetUnconfigured`. Gate limpo; rota
    `family/month` 200 em runtime.
  - **Divergência explicada (Opção A + expand):** o card de totais mostra
    "Inclui R$ X de N compras de cartão que vencem este mês e foram feitas
    antes", com `<details>` listando cada compra (descrição, data, categoria,
    valor) — porque essas compras pesam em M mas aparecem na timeline no mês da
    compra. `state.cardDueOtherMonth = {cents, count, items[]}`.
- AC3.5 (Mundo B — compra na timeline pela data, com selo do cartão) Cada compra
  de cartão aparece na timeline do mês na sua data de compra, com um selo
  pequeno/light do cartão; o valor real é preservado (nunca zerado — decisão 8).
  - ✅ **Implementado (2026-11-07):** `Movement.cardLabel`
    (`src/domain/movements.ts`); `app/family-movements.tsx` mostra selo
    `.movement-card-badge` (💳 nome do cartão) e o status "No cartão · entra na
    fatura" para compras de cartão pendentes, sem ar de aprovação individual. A
    linha fica na data da compra (timeline ordena por data). Gate limpo.
  - Limite conhecido: cobre compras ainda `pending` (via `bankPending`). Uma
    compra de cartão já materializada como `economic_event` não carrega o selo
    (não há o caso no fluxo Forma 2 atual, pois compras de cartão não viram
    evento). Validar em runtime.

## Estados de erro por tela (Fases 1–2)

| Tela/Ação | Condição | O que o usuário vê |
| --- | --- | --- |
| Movimentos · item provisório | `provider_status<>'POSTED'` | "Ainda provisório no banco. Não pode ser registrado nos totais." Sem botão aprovar. |
| Aprovar item | candidato de duplicata não resolvido | "Há um possível registro anterior. Vincule-o ou justifique que é distinto." |
| Aprovar transferência | falta conta de destino | "Escolha a conta de destino desta transferência." |
| Aprovar cartão (compra avulsa) | tentativa de registrar compra de cartão | "Compras de cartão entram pela fatura, não uma a uma." |
| Rejeitar | nota < 8 chars | "Explique por que este movimento deve ficar fora dos totais." |
| Lote "Aprovar simples" | nada elegível no mês | "Nenhuma despesa ou entrada simples de conta corrente neste mês." |
| Qualquer ação | versão do item mudou (releitura concorrente) | "O movimento mudou. Atualize antes de aprovar." |

## Fora de escopo (desta spec)

- Leitura agendada por cron (já existe `banks/read-due` + `CRON_SECRET`).
- Categorização automática por IA na aprovação (os lançamentos entram sem
  categoria; categorizar é passo separado).
- Desfazer em lote (reverter muitos `recorded` de uma vez).

## Ordem de implementação sugerida

Fase 1 → Fase 2 → (fechar decisões em aberto) → Fase 3. Cada fase passa pelo
gate `npm run typecheck` + `npm run lint` (zero warning) antes de seguir. Não há
framework de teste no projeto; a verificação é typecheck+lint+conferência manual
no banco local (PGlite) via query de contagem.
