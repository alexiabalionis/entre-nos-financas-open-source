# Copiloto Financeiro: motor de projeção (v3.1)

Status: direção arquitetural aprovada (v3). Este documento registra as decisões
consolidadas na v3.1 e o andamento das etapas. A especificação completa da v3
(motores, fórmulas, fixtures F e cenários A a I, matriz de testes) foi
aprovada em conversa e deve ser transcrita aqui antes de F0.

## Etapas

| Etapa | Conteúdo | Estado |
| --- | --- | --- |
| K0 | `cardCompetence()` pura em `src/domain/card-competence.ts` | Aprovada |
| K1 | Histórico mínimo de ciclos (`card_cycle_versions`, migration 022) | Implementada, aguardando validação. Migration ainda não aplicada no banco do app |
| K2 | Leitores (`state.ts`, `routine.ts`, `cards.ts`) usando `cardCompetence` com as versões | Em andamento. Publicar junto com a K1 |
| K3 | Backfill | **Removida**: a competência é recalculada de forma determinística pelas versões; nenhum dado financeiro é regravado |
| F0 a F6 | Copiloto (ver v3) | Não iniciada |

## Três eixos temporais

- **Transacional:** quando aconteceu. Data da compra (`purchase_date`, senão `transaction_date`). Nunca é sobrescrita. Usada pela timeline e pelo motor comportamental.
- **Competência:** mês do orçamento. No cartão, é o mês de vencimento da fatura a que o lançamento pertence. Fora do cartão, mês da transação (receita segue `budget_offset`).
- **Caixa:** quando o dinheiro sai ou entra numa conta incluída. No cartão, a data do pagamento da fatura; até lá, o vencimento da obrigação.

## Decisões consolidadas na v3.1

### D1. Histórico de ciclos

1. Ordem de evidência da competência: fatura identificada pelo banco (`bill_id`), depois vencimento registrado no lançamento (`economic_events.due_date` ou `staged_transactions.due_date`), depois ciclo.
2. O ciclo só vale para compras dentro da validade de uma versão (`valid_from` a `valid_until`) **e** se essa versão continuar valendo até o fechamento da fatura inferida. Se o ciclo mudou antes desse fechamento, a competência fica incerta.
3. O ciclo atual nunca é estendido para o passado. Compra anterior à primeira versão conhecida, sem fatura nem vencimento registrado, fica `unknown`.
4. Fatura explícita divergente da inferência vence a inferência e o conflito é registrado (`conflict.cycleMonth`) para diagnóstico.
5. No backfill (K3), casos `unknown` permanecem nulos e são listados como "competência a confirmar". Nada é inferido para preencher lacunas.

### D2. Identidade dos parcelamentos

1. Identidade da **parcela** = identificador bancário da linha (`bank_transactions.remote_id`). Imutável.
2. Identidade da **compra original** (série) = (cartão, `purchase_date`, total de parcelas, `merchantKey` sem marcador de parcela, valor base), com índice de multiplicidade quando há séries idênticas na mesma fatura.
3. Duas linhas só pertencem à mesma série se todos os componentes coincidirem. Semelhança (mesmo estabelecimento, valor próximo, data vizinha) nunca funde compras.
4. A tolerância de centavos vale apenas para casar a última parcela com uma série já identificada, nunca para criar ou fundir séries.
5. Parcela sem `purchase_date` não é anexada por semelhança: forma uma série provável própria, marcada como incerta, até haver evidência (fatura, vínculo explícito ou confirmação).
6. Parcelas derivadas (ainda não lançadas pelo banco) só existem para séries identificadas e são substituídas pela linha real de mesmo número.

### D3. Transações que somem do banco (`missing`)

O desaparecimento não é cancelamento. Estados distintos:

| Estado | Evidência | Caixa | Competência | Comportamento |
| --- | --- | --- | --- | --- |
| Ausência temporária | Sumiu numa leitura incompleta, com erro ou fora da janela lida | Mantém | Mantém | Mantém |
| Substituição | Linha nova equivalente com vínculo por identificador ou confirmação (IDs reemitidos após reconexão) | Um fato só | Um fato só | Uma decisão só |
| Cancelamento provável | Pendente que sumiu em leituras completas e não foi substituída | Conservador mantém, nominal remove (lacuna com impacto) | Mantém com marca | Mantém até confirmar |
| Cancelamento confirmado | Confirmação da pessoa, ou fatura fechada pelo banco sem o lançamento | Remove | Remove | Anula a decisão |
| Estorno | Linha de crédito explícita | Reduz a fatura onde entra | Ajuste negativo na competência dessa fatura | Restaura conforme regra de estorno |

### D4. Orçamento comportamental

1. Toda decisão de compra guarda o **compromisso total** (valor integral, inclusive parcelada).
2. A decisão separa a parte **planejada** (absorvida por item do plano) da parte **discricionária**.
3. O impacto na semana e no Pool considera só a parte discricionária. A parte planejada consome o item do plano no motor de competência.
4. Compromisso total e impacto semanal são medidas diferentes e são exibidas separadamente.
5. Política atual: a parte discricionária é reconhecida inteira na data da decisão. O modelo guarda os dois valores para que outras políticas possam existir sem mudar os dados.

## K0: contrato implementado

`cardCompetence(input) => { month, dueDate, source, reason, conflict }`

- `source`: `bill`, `declared`, `cycle`, `installment_cycle` ou `unknown`.
- Não recebe status de aprovação nem tabela de origem.
- Parcela k > 1: competência pela data da compra deslocada k−1 meses; sem data da compra, só por fatura ou vencimento registrado.
- Datas inválidas lançam erro; parcela inválida retorna `unknown`.
- Testes: `tests-js/card-competence.test.ts`.

## K1: histórico mínimo de ciclos (Alternativa A)

Decisão: uma tabela simples, sem colunas de evidência, origem ou substituição,
e sem congelar competência por lançamento. `economic_events.due_date` continua
vindo só da importação de extratos.

**Tabela** `card_cycle_versions`: cartão, família, fechamento, vencimento,
offset, `valid_from` (primeira data de compra coberta), `first_close_date` e
`first_due_date` (primeira fatura da versão), `created_by`, `created_at`. O fim
da vigência é a véspera do `valid_from` seguinte. `UNIQUE(household_id,
account_id, valid_from)` impede inícios iguais; com o fim derivado, não há
sobreposição.

**Primeira versão** (migration e primeiro salvamento): vale desde o dia do
salvamento, ou desde o dia seguinte ao fechamento informado se ele já tinha
passado. Compras anteriores sem fatura nem vencimento explícito ficam
`unknown`. A migration só insere; `card_cycles` não é alterada.

**Mudança de ciclo:** vale a partir do dia seguinte ao fechamento da fatura
aberta. A primeira fatura nova é a primeira do ciclo novo que fecha depois
desse fechamento, num mês de vencimento posterior ao da fatura aberta (nunca
duas faturas no mesmo mês). As datas digitadas precisam coincidir com essa
fatura; senão o erro mostra as datas corretas.

**Edições:**
- Versão vigente nunca muda, exceto a primeira enquanto a sua primeira fatura
  não fechou (correção do cadastro, que hoje pode vir pré-preenchido com
  estimativa).
- No máximo uma versão futura por cartão: nova edição a substitui no lugar;
  voltar ao ciclo vigente a apaga.
- Correções históricas ficam fora do fluxo comum.

**Leitores atuais:** `card_cycles` só é atualizada quando a versão vale de
imediato (primeira ou correção dela). Versões futuras não alteram `state.ts`
nem `cards.ts`. Depois que uma versão futura entra em vigor, esses leitores
ficam com a regra anterior até a K2.

**Auditoria:** `audit_events` `card.cycle` guarda `close_date`, `due_date`,
`action` (`create`, `replace_first`, `schedule`, `replace_future`,
`cancel_future`, `unchanged`), `version_id`, `valid_from`, primeira fatura e
`before` (versão substituída).

**Pendências fora da K1** (arquivos com mudanças de outra sessão):
- Incluir `card_cycle_versions` na exportação completa (`app/api/[...path]/route.ts`).
- Texto de sucesso do formulário mostrando "vale a partir de" (`app/family-cards.tsx`).

### K1: correções pós-review (substituem o que conflitar acima)

- **Âncora:** `first_close_date`/`first_due_date` foram trocadas por
  `first_due_month`. As datas da primeira fatura saem da própria regra
  (`ruleBill`), então a âncora não diverge do ciclo.
- **Primeira versão:** vale desde hoje; se o fechamento digitado já passou,
  desde o dia seguinte a ele, mas nunca antes do início da fatura aberta hoje.
  A primeira fatura é a da regra que contém `valid_from` (janela de um ciclo).
  O "próximo fechamento" digitado pode estar a no máximo 62 dias.
- **Correção da primeira versão:** mantém o início original; a primeira
  fatura é recalculada pela regra corrigida a partir desse início.
- **Só versão futura, sem vigente:** o novo cadastro toma o lugar dela.
- **Cancelar mudança agendada:** só quando a pessoa informa o fechamento
  atual. Reenviar o ciclo antigo que a tela mostrava devolve erro dizendo que
  há uma mudança agendada e a partir de quando.
- **Migration:** calcula a fatura que contém o dia do salvamento como
  `cardCyclePeriod` (dia limitado ao fim do mês). Ciclos cuja fatura nesse mês
  teria vencimento até o fechamento ficam sem versão (competência
  desconhecida até salvarem de novo). Seed idempotente (`ON CONFLICT DO
  NOTHING`).
- **RLS:** DELETE só em versões ainda não vigentes.
- **Regra única:** validação e regra vêm só de `planCycleSave`; as duas
  gravações (versão e espelho em `card_cycles`) usam o mesmo resultado.
- **Auditoria:** a ação do plano fica em `metadata.plan_action`.
