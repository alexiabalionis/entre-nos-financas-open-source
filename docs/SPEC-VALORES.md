# SPEC-VALORES: contratos de valores financeiros

Este documento dá nome e significado a números que o app já calcula. Não cria camada, projeção nem motor novo. Cada regra aponta a implementação e os testes que a sustentam.

Legenda: **[C]** comportamento confirmado, **[P]** contrato, **[D]** divergência conhecida, **[?]** decisão pendente.

## 1. Quatro perguntas, quatro contratos

| Contrato | Pergunta | O que reconhece | Quando | Implementação | Testes |
|---|---|---|---|---|---|
| Consumo | Quanto gastei? | Eventos `expense`, `card_purchase`, `fee`, `refund` e pendências do banco auto-contadas | Data da compra ou do lançamento | `readRealizedSpend` (`src/server/realized-spend.ts`) | `realized-spend.test.ts`, `value-contracts*.test.ts` |
| Comprometimento | Quanto do orçamento já saiu ou vai sair? | Consumo por competência mais o previsto em aberto | Cartão pelo vencimento da fatura | `spending` em `src/server/state.ts`, `commitment` e `categoryOutflow` (`src/domain/budget.ts`), `card-competence.ts` | `budget.test.ts`, `card-competence-readers.test.ts`, `no-double-count.test.ts` |
| Caixa realizado | O que saiu das contas? | Lançamentos no ledger | Data do lançamento | Saldo em `state.ts` e `readBalance` (`src/server/insights.ts`) | `insights.test.ts` |
| Caixa projetado | O que ainda vai sair? | Fluxos reconciliados (faturas, itens, reserva, agendados) | Vencimento; vencido cai em hoje | `src/domain/projection*.ts` | `projection-*.test.ts` |

Divergência entre contratos é legítima. Divergência dentro do mesmo contrato é defeito. `stalenessFrom` (defasagem do saldo) e a unificação de `purpose` ficam fora do escopo.

## 2. Invariantes

- **I1.** Cada obrigação conta uma vez por contrato. A identidade vem dos vínculos existentes, sem campo novo: `bank_transactions.event_id`, `monthly_items.event_id`, `reserve_movements.bank_transaction_id` e `economic_events.related_event_id`.
- **I2.** Pagamento de fatura nunca é consumo (`economicEffect("card_payment") = 0`; pendências `PAGAMENTO_FATURA` excluídas).
- **I3.** Reserva nunca é consumo. Reduz o caixa. A linha do banco vinculada a um movimento de reserva conta uma vez, fora do consumo.
- **I4.** A regra de inclusão de pendências é uma só: `readPendingCardPurchases` e `readAutoCountedChecking`. `state.ts` as reutiliza.
- **I5.** Sinal: totais e listas preservam o sinal. Gráficos de proporção ignoram peso menor ou igual a zero. Indicadores de magnitude habitual (ritmo semanal, base do alerta de excesso, referência de teto) usam o líquido do período com piso em zero, sem alterar o consumo líquido exibido.

## 3. Regras

| # | Regra | Status | Teste |
|---|---|---|---|
| R1 | Cartão: consumo pela data da compra; comprometimento pelo vencimento da fatura; sem ciclo conhecido, o mês da compra (estimado) | [C] | `card-competence-readers.test.ts` |
| R2 | Parcelado: cada parcela é um lançamento; consumo na data do lançamento; competência por `installment_cycle` | [C] | sem teste de consumo |
| R3 | Reserva fora do consumo; `state.ts` usa os leitores compartilhados | [C] implementado | `value-contracts` 1 |
| R4 | Estorno reconhecido na data em que ocorre, com a categoria da compra original; meses anteriores não são reabertos. Convenção de produto. O evento `refund` exige `related_event_id` (`imports.ts`) | [C] implementado | `value-contracts` 2, 3 |
| R5 | Benefício: item `benefit` é compromisso e fica fora do caixa | [C] | sem teste dedicado |
| R6 | Item parcial vinculado a evento mantém o restante (planejado menos pago) no comprometido | [C] implementado em `openPlannedCents` | `budget.test.ts`, `value-contracts-negative` 12 |
| R7 | Estorno de conta fixa abate o "dia a dia" | [D] fora do escopo (D5), `value-contracts-negative` 13 | |

## 4. Pagamento manual

Três conceitos distintos:

| Conceito | Fonte | Quem enxerga |
|---|---|---|
| Obrigação quitada | `monthly_items.status` e `paid_cents` | Plano do Mês, lembretes |
| Despesa realizada | `economic_events` ou pendência auto-contada | Consumo e Comprometimento |
| Movimentação confirmada | `bank_transactions.event_id` e ledger | Caixa realizado |

Quitar um item sem lançamento não cria despesa realizada [C]. O valor aparece separadamente como **"pago sem lançamento associado"** no Plano do Mês (`paidWithoutEntryCents` em `app/month/plan-model.ts`, exibido por `plan-group.tsx`): `status IN ('partial','done')`, `event_id IS NULL`, `paid_cents > 0`, derivado de `monthly_items`, sem persistência nova. Nunca soma ao consumo nem ao comprometimento. Quando a linha do banco chega, o gasto passa a contar por ela.

## 5. Insights

- Categorias, dias e fixo mais dia a dia saem do mesmo universo (`readRealizedSpend`).
- `months[].out` é a soma desse mesmo universo por mês: consumo líquido, com pendências e estornos.
- `months[].in` soma as entradas de eventos e as pendências de entrada auto-contadas, como o Mês faz.
- O saldo vem do ledger e pertence ao Caixa realizado.

## 6. Valores negativos

| Consumidor | Contrato |
|---|---|
| `categoryPeriods`, `categoryOutflow` | Preservam a categoria líquida negativa; só omitem a categoria com valor zero |
| `dailySpend` | Dia líquido pode ser negativo |
| `weeklyTotals`, base do alerta de excesso, referência de teto | Líquido com piso em zero |
| `percentShares`, `CalendarHeat` | Peso ou intensidade negativos valem zero; o valor exibido mantém o sinal |
| `CompareBarChart` | O eixo inclui o menor valor negativo |
| `places` | Ignora valor menor ou igual a zero |

## 7. Pendências

- **D5 [?].** Estorno de conta fixa: reutilizar a classificação da compra original via `related_event_id`. Fora desta entrega.
