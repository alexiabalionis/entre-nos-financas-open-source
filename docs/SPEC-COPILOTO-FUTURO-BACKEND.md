# Spec · Backend do Copiloto "Futuro" (projeção de 3 a 36 meses)

Status: pronta para implementação · Escopo: **somente backend** (domínio puro, leituras, rotas, testes).
A tela é outra tarefa e consome o que esta spec entrega.

## 1. Contexto

O Copiloto ganha uma visão de futuro (protótipo aprovado: `app/preview-copiloto?v=ab`, alternativa
"A+B · Editorial + Jornada"). Ela mostra, mês a mês, por até 24 meses:

- frase de destaque com os marcos próximos (ex.: "a reserva chega a R$ 10.000 em março de 2028");
- trilhos por objetivo/compromisso com a data de chegada;
- uma "estação" por mês com o fluxo do mês (verba, fatura, aportes, folga) e a posição no fim do mês;
- a fatura do cartão por mês, **por item** (recorrentes, parcelas com k/n e última parcela, dia a dia estimado);
- "próximas decisões" calculadas por regra;
- simulação (mudar aporte, parcelar uma compra, imprevisto) com comparação antes/depois, sem gravar nada;
- "salvar como plano" grava o aporte dos próximos meses.

O motor de referência das regras está no protótipo: `app/preview-copiloto/engine.ts` (valores em reais,
dados fictícios). **Ele é especificação de comportamento, não código a copiar**: aqui tudo é em centavos
`bigint` e alimentado pelos dados reais da família.

Leia antes de começar: `PRODUCT.md` (princípios), `src/server/projection.ts` (coletor atual),
`src/server/projection-reads-*.ts`, `src/domain/projection-*.ts`, `src/domain/recurrence.ts`,
`src/domain/reserve*.ts`, `src/server/reserves.ts`.

## 2. Fora de escopo

- Qualquer UI (componentes, CSS, hooks de tela).
- Cadastro de **dívidas** (não existe no modelo; fase futura com migração própria). Na v1 os
  "compromissos que terminam" são as **parcelas do cartão** já derivadas por `deriveInstallments`.
- Juros, rendimento, cotação: nada é inventado.
- IA/LLM: tudo é determinístico.
- Mudar números das telas existentes (aba Mês, `family/copilot`, `family/projection`, `cards/projection`).
  Refatorações que extraem helpers são permitidas **sem alterar resultados** (os testes atuais precisam passar
  sem edição de expectativa).

## 3. Princípios obrigatórios

1. **Reaproveitar, não reimplementar.** Competência de cartão só via `card-competence`; ocorrências só via
   `recurrence.ts`; saldo de reserva só via `goalBalance`/`planProgress`; resolução de fatura só via a
   mesma regra de `reconcileBill`. Se precisar de uma variação, extraia um helper do módulo original.
2. **Centavos `bigint`** no domínio e no servidor; no fio, `bigint` vira `string` (padrão `Wire<T>` de
   `src/server/copilot.ts`). Meses `'YYYY-MM'`, dias `'YYYY-MM-DD'`.
3. **Domínio puro e executável no navegador.** `src/domain/future-months.ts` não importa nada de
   `src/server`, `node:*` nem banco. A tela vai reexecutá-lo localmente para simular.
4. **Leituras por família** com `asUser(db, user.userId, tx => …)` e `household_id` (RLS), como os leitores
   `projection-reads-*`.
5. **Nunca contar o mesmo dinheiro duas vezes** (fatura × dia a dia × contas fixas × plano). Cada regra de
   exclusão precisa de teste.
6. **Toda estimativa é marcada** (`source`/`quality`) e toda premissa vira texto em `premises[]`.
7. **Reserva não é dinheiro para gasto corrente**: déficit de um mês sai do saldo em conta, nunca da reserva.
8. **Simulação nunca grava.** Só as rotas de escrita listadas na seção 7 gravam.

## 4. Mapa de reuso (fonte de cada número)

| Grandeza mensal | Fonte existente | Observação |
|---|---|---|
| Saldo inicial em conta | `readCashSnapshot(tx, familyId).sConf` (`projection-reads-cash.ts`) | também expor `snapshotDate` |
| Renda do mês | `recurrences` com `purpose='income'`, não pausadas; datas por `occurrencesBetween` + `expectedDate`; mês por `planningMonth` (`src/domain/recurrence.ts`) | renda já recebida no mês corrente sai de `readReceipts` (não somar de novo) |
| Contas fixas | `recurrences` com `purpose='expense'`, não pausadas; mesmas funções | no mês corrente/próximo, `monthly_items` já gerados têm precedência (mesma regra de `readItems`); não somar série + item |
| Fatura do cartão (total) | `readBills(tx, familyId, competence, months, true)` → `BillInput[]`; total do mês = mesma resolução de `reconcileBill` (usar `consBase` antes de pagamentos; `manual.paid` = 0) | `competence = await loadCardCompetence(tx, familyId)` |
| Parcelas futuras (por compra) | `deriveInstallments(lines, cyclesByCard, fromMonth)` → `InstallmentSeries[]` | hoje `readBills` só devolve a soma (`byBill`); expor as séries (seção 6.3) |
| Total por cartão + origem | `readCardProjection` (`src/server/cards.ts`) | referência de consistência: o total da v1 deve bater com ele nos meses em comum |
| Dia a dia estimado | `readUsualWeekly(tx, {...})` (`projection-reads-everyday.ts`), fallback `settings.everydayWeekly` | semanal → mensal = `weekly × dias_do_mês / 7` (mês 0: só dias a partir de hoje) |
| Objetivos | `goals` (target, `deadline_month`, `priority`, `status`) via `readReserves`/`listGoals`; saldo via `goalBalance(movements)` | `paused` → aporte 0; `done`/`archived` fora |
| Aporte planejado | `reserve_plans` vigentes (`superseded_by IS NULL`) por mês, via `readReserve(tx, { familyId, months })` | mês sem plano: premissa da seção 5.3 |
| Simulação de compra no cartão | `projection-simulate.ts` (`installmentSplit`, `billOf`, `billForDueMonth`) | extrair helper exportado (seção 6.4) |
| Configuração | `readFinanceSettings` (cushion, everydayWeekly, copilotMargin) | |
| Sugestão de meta/aporte | `firstTarget`, `suggestAmount` (`reserve-suggestion.ts`) | usar no "novo objetivo" |

## 5. Domínio: `src/domain/future-months.ts`

### 5.1 Tipos de entrada

```ts
export type FutureInput = {
  today: string;                 // 'YYYY-MM-DD'
  startMonth: string;            // mês 0 = mês de today
  months: number;                // 3..36
  startBalance: bigint;          // sConf
  income: MonthAmount[];         // por mês, já sem o que foi recebido
  fixed: MonthAmount[];          // contas fixas por mês (fora do cartão)
  everyday: { weekly: bigint | null; source: "medido" | "declarado" | "ausente" };
  cards: CardFuture[];
  goals: GoalFuture[];
  essentialsMonthly: bigint;     // ver 5.3
};
export type MonthAmount = { month: string; cents: bigint; items: { key: string; label: string; cents: bigint; source: Source }[] };
export type Source = "banco" | "manual" | "plano" | "recorrencia" | "estimado";

export type CardFuture = {
  card: string; name: string;
  cycles: CycleVersion[];        // para simular compra no cliente
  bills: { month: string; total: bigint; quality: Quality; source: Source }[];
  installments: { key: string; label: string; cents: bigint; k: number; n: number; month: string; lastMonth: string }[];
  // recorrentes no cartão = recorrências de despesa com account_id do cartão (somam à fatura, não a `fixed`)
  recurring: { key: string; label: string; cents: bigint }[];
};
export type GoalFuture = {
  id: string; name: string; status: "active" | "paused";
  target: bigint; saved: bigint; deadlineMonth: string | null; priority: number;
  plans: { month: string; planned: bigint }[];  // vigentes, do mês 0 em diante
};
```

### 5.2 Cenário (overrides de simulação, sempre opcionais)

```ts
export type Scenario = {
  contributions?: { goalId: string; fromMonth: string; months: number | null; cents: bigint }[]; // null = até o fim
  pauses?: { goalId: string; fromMonth: string; months: number }[];
  newGoals?: Omit<GoalFuture, "id" | "plans"> & { id: string; monthly: bigint }[];
  purchases?: { card: string; cents: bigint; installments: number; day: string }[]; // usa o helper da 6.4
  shocks?: { kind: "despesa" | "receita"; month: string; months: number; cents: bigint; label: string }[];
  everydayWeekly?: bigint;
  freedTo?: "folga" | "objetivos"; // valor liberado por parcela que termina
};
export function applyScenario(input: FutureInput, s: Scenario): FutureInput;
export function projectFuture(input: FutureInput): FutureResult;
```

### 5.3 Regras por mês `i` (0..months-1)

- `preCard = income − fixed − everyday(i)`; `card = Σ fatura dos cartões em i`; `budget = preCard − card`.
- `everyday(i)`: `weekly × diasDoMês/7`; no mês 0 só os dias de `today` até o fim do mês. `weekly = null` →
  0 + premissa "sem histórico de dia a dia".
- **Aporte do objetivo em i**: plano vigente do mês i; se não houver, **o último plano conhecido ≤ i se repete**
  (premissa explícita). `paused` = 0. Limitar ao que falta para a meta (não passar do alvo). Depois de
  atingir, aporte 0.
- `free = budget − shocks(i) − Σ aportes(i)`.
- `free < 0` → `bank += free` (déficit sai do saldo em conta) e entra em `conflicts`. Premissa: folga positiva
  é considerada gasta no mês (o saldo não cresce com ela).
- `freedTo = "objetivos"`: o valor de uma parcela que terminou no mês anterior vai para os objetivos por
  `priority` (sem passar da meta); o resto volta para a folga. Default `"folga"`.
- `reserves = Σ saldos dos objetivos`; `committed = Σ parcelas futuras ainda não pagas`.
- `netWorth = bank + reserves − committed` (escopo declarado em `premises`).
- `essentialsMonthly` = contas fixas médias + dia a dia mensal (premissa, usada só para cobertura da reserva).

### 5.4 Saída

```ts
export type FutureRow = {
  month: string; preCard: bigint; card: bigint; budget: bigint; shocks: bigint;
  goalIn: Record<string, bigint>; goalBal: Record<string, bigint>;
  free: bigint; bank: bigint; reserves: bigint; committed: bigint; netWorth: bigint;
  cardParts: { card: string; parts: { key: string; label: string; cents: bigint; kind: "recorrente" | "parcela" | "fatura" | "estimado"; k?: number; n?: number; lastMonth?: string }[] }[];
};
export type Milestone = { id: string; kind: "goal-reached" | "cover-1" | "cover-3" | "goal-due" | "installment-end" | "all-installments-end";
  month: string; refId: string; title: string; short: string; why: string[]; missed?: boolean };
export type FutureResult = {
  rows: FutureRow[]; milestones: Milestone[];
  reach: Record<string, string | null>;       // goalId → mês em que completa
  conflicts: { month: string; cents: bigint; cause: string }[];
  viability: { level: "ok" | "apertado" | "inviavel"; title: string; detail: string };
  decisions: Decision[]; premises: string[];
};
export function compareFuture(a: FutureResult, b: FutureResult, horizon: number): DiffItem[];
export function describeScenario(base: FutureInput, s: Scenario): string[];
```

- `why[]` traz a **conta legível** (ex.: "Faltavam R$ 7.700 · 16 aportes de R$ 500 · último em mar/2028").
  Seguir os textos do protótipo (`milestonesFor` em `engine.ts`).
- `parcela` em `cardParts`: só quando a fatura do mês **não** tem total oficial do banco; com total oficial,
  listar as parcelas conhecidas e uma linha `fatura` = total − Σ partes listadas (nunca negativa). A soma das
  partes **sempre** fecha com `card`.
- **Decisões** (cada uma com `calc` = conta verificável, `impact`, `action?` como `Scenario` parcial):
  1. primeiro mês com `free < 0` ("A fatura de jan/27 consome toda a folga prevista");
  2. reserva cobre < 1 mês de `essentialsMonthly`;
  3. objetivo com `deadlineMonth` que não chega na data → aporte necessário `ceil((target−saved)/(meses até a data, inclusive))`;
  4. parcela que termina nos próximos 12 meses ("a fatura cai R$ X em <mês>");
  5. aportes regulares acima da verba (`viability = inviavel`).
- **Viabilidade**: `inviavel` se aportes regulares > verba típica ou `bank < 0` no horizonte; `apertado` se há
  `conflicts`; senão `ok`.
- `compareFuture`: datas de conclusão por objetivo (delta em meses, "passa a acontecer"/"sai do horizonte"),
  folga do mês 0, mês mais apertado, menor saldo em conta, patrimônio no fim do horizonte. Ver `compare` no protótipo.

## 6. Servidor

### 6.1 `src/server/future-plan.ts`

```ts
export async function readFuture(db: Database, user: Identity, opts: { months?: number; today?: string } = {}):
  Promise<{ input: FutureInput; result: FutureResult }>;
export type FutureWire = Wire<Awaited<ReturnType<typeof readFuture>>>;
export function toFutureWire(...): FutureWire;
```

- Uma transação `asUser`. `months` default 24, mínimo 3, máximo 36 (`UserError` fora disso).
- Monta `FutureInput` exclusivamente pelas fontes da seção 4; roda `projectFuture`.
- `today` injetável (testes), padrão `readToday(tx)`.

### 6.2 Rotas (`app/api/[...path]/route.ts` + `src/server/api-policy.ts`)

| Rota | Método | Política | Corpo / query | Retorno |
|---|---|---|---|---|
| `family/future` | GET | `reads` | `?months=24` | `FutureWire` |
| `reserves/plan-range` | POST | `writes` | `{ goal_id, from_month, months, planned, version?: number }` | `{ ids: string[] }` |

`reserves/plan-range`: uma transação; para cada mês reaproveita a lógica de `savePlan` (substitui o vigente
com `superseded_by`, nunca apaga), `canWrite(user)`, `lockGoal`, auditoria `reserve.plan` por mês.
Extraia de `savePlan` uma função interna `savePlanTx(tx, user, {goal_id, month, planned, version_of?})` e
use nas duas rotas, sem mudar o comportamento de `reserves/plan`. `months` 1..36; `planned` ≥ 0 (0 = pausa).

Perfil leitor (`reader`) recebe 403/`UserError` na escrita, como as rotas `reserves/*` atuais.

### 6.3 Parcelas por compra

Hoje o cálculo interno de `readBills` agrega `derived.byBill` em `estimate`. Extrair (sem mudar `readBills`):

```ts
export async function readCardFuture(tx, familyId, competence, months): Promise<{
  bills: BillInput[];                 // o mesmo que readBills(..., true)
  series: InstallmentSeries[];        // de deriveInstallments, com label = merchant legível
  observed: { key: string; month: string; k: number; n: number; cents: bigint }[]; // parcelas já lançadas nos meses pedidos
}>;
```

`label`: descrição original legível (não a normalizada), igual ao que a aba Movimentos mostra.

### 6.4 Compra simulada no cartão

Em `projection-simulate.ts`, extrair e exportar:

```ts
export function cardPurchaseSchedule(h: { cents: bigint; day: string; installments: number; cycles: CycleVersion[] }):
  { k: number; dueMonth: string; due: string; cents: bigint }[];
```

`simulate()` passa a usá-lo internamente (testes de `projection-simulate.test.ts` intactos).
`applyScenario` usa o mesmo helper para `purchases`.

## 7. Escritas (únicas permitidas)

- `reserves/plan-range` (nova): "salvar como plano" de aportes.
- `reserves/create` e `reserves/plan` (existentes): novo objetivo + primeiro plano.
- Nada mais grava. Simulação, compra hipotética e imprevistos vivem só no cliente.

## 8. Testes (Node test + PGlite em memória, padrão de `tests-js/projection-collector.test.ts`)

Domínio (`tests-js/future-months.test.ts`):

- Cenário do briefing reproduzido em centavos: renda 600000, essenciais/fixas conforme protótipo, cartão com
  fatura 130000 em dez/26, 185000 em jan/27, 114000 de mar/27, 88000 de jul/27; reserva 230000→1000000 com
  50000/mês completa em **mar/2028**; viagem 90000→400000 até dez/27 com aporte 0 → `goal-due` com `missed`,
  decisão com aporte 23900/mês; jan/27 com `free = −15000` e `conflicts` só nesse mês.
- Último plano conhecido se repete; plano 0 = pausa; objetivo `paused` não recebe.
- Aporte não passa da meta e para depois de atingida.
- Déficit reduz `bank`, nunca `goalBal`.
- `freedTo="objetivos"` respeita `priority` e a meta.
- Soma de `cardParts` = `card` em todos os meses (com e sem total do banco).
- `applyScenario` com `purchases` gera as mesmas parcelas/meses que `simulate()` para o mesmo ciclo.
- `compareFuture` e `describeScenario`: casos "antecipa N meses", "passa a acontecer", "sai do horizonte".
- Determinismo: mesma entrada → mesma saída (deep equal).

Coletor (`tests-js/future-collector.test.ts`), com `today` fixo:

- Renda e conta fixa vindas de `recurrences` aparecem nos meses certos (incl. `fifth_business_day`).
- Mês corrente: item já gerado em `monthly_items` não duplica a série; renda já recebida não soma de novo.
- Cartão com fatura oficial do banco + parcelas derivadas: total bate com `readCardProjection` nos meses em comum.
- Dia a dia: compra parcelada **não** entra também no dia a dia (verificar se `readUsualWeekly` inclui
  parcelas; se incluir, excluir no coletor e testar).
- Isolamento: família B não vê dados da família A.
- `reserves/plan-range`: substitui planos vigentes, preserva histórico (`superseded_by`), audita por mês,
  bloqueia leitor, valida limites.

Regressão: `npm test`, `npm run typecheck`, `npm run lint` verdes; nenhum teste existente com expectativa alterada.

## 9. Critérios de aceite

1. `GET family/future?months=24` responde em uma transação e devolve `input` + `result` coerentes
   (reexecutar `projectFuture(input)` no cliente dá o mesmo `result`).
2. Todo número tem origem rastreável (seção 4) e toda estimativa aparece em `premises`/`source`.
3. Nenhum valor é contado duas vezes (testes da seção 8).
4. `src/domain/future-months.ts` roda no navegador (sem imports de servidor/Node).
5. Telas e rotas existentes com os mesmos números.
6. Textos em pt-BR, sem julgamento ("não tem folga suficiente", nunca "você gastou demais").

## 10. Ordem sugerida de entrega (commits pequenos)

1. Extrair `cardPurchaseSchedule` + `savePlanTx` (refactors sem mudança de comportamento, testes verdes).
2. `future-months.ts` + testes de domínio.
3. `readCardFuture` + `readFuture` + coletor + testes.
4. Rotas `family/future` e `reserves/plan-range` + política + testes.

Trabalhar numa branch própria; o working tree principal tem mudanças não commitadas em `app/copilot/*`
que não fazem parte desta tarefa.

## 11. Perguntas em aberto (decidir com quem mantém o produto, não bloquear)

- Valor liberado por parcela que termina: default `"folga"` está ok ou deve ir para objetivos?
- `essentialsMonthly`: usar fixas + dia a dia (proposta) ou uma marcação de categorias essenciais?
- Horizonte máximo 36 meses é suficiente?
