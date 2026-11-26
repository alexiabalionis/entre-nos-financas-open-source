# Recorrências: antes e depois desta entrega

Status: aprovada para implementação faseada (D1, D2, D3 decididas; correções P1 a P5 incorporadas). Nada implementado. Base: código em `e236074` (main).

Objetivo: um núcleo único de recorrência (`recurrences` + `recurrence_occurrences`) usado por
despesas fixas e entradas recorrentes, sem forçar regras financeiras diferentes a parecerem iguais,
e sem trocar o mecanismo de entradas antes de provar equivalência.

---

## 1. Antes e depois, por assunto

| Assunto | Antes (hoje, confirmado no código) | Depois |
|---|---|---|
| O que é "conta fixa" | Cinco regras diferentes: `categories.fixed`, `cost_type` do item, palpite por nome (`dashboard.ts:9`), itens agregados por categoria (`routine.ts:59`), recorrência adivinhada + `recurrence_decisions` na projeção | Despesa (`purpose='expense'`) ligada a uma recorrência. Uma função só, usada por todas as telas |
| Despesa que se repete | Copiar o mês anterior inteiro (`copyMonth`) ou palpite da projeção | Recorrência explícita, criada à mão ou a partir de uma transação do Pluggy |
| Entrada recorrente (salário) | `income_rules` + `income_occurrences`, mecanismo próprio, só mensal | Mesma recorrência do núcleo, com as regras de data e de mês de planejamento das entradas preservadas |
| Categoria fixa | Classifica todos os gastos da categoria | Deixa de classificar. Coluna fica no banco sem uso |
| Frequência | Só mensal (entradas) | Diária, semanal, mensal, anual, a cada N |
| Editar uma ocorrência | Editar o item do mês | Igual (o item continua sendo o lugar da edição) |
| Esta e as seguintes / encerrar | Não existe para despesas. Entradas: editar a regra reescreve datas de todos os meses (ver 6.3) | Operações do núcleo, iguais para despesas e entradas |
| Mudar uma ocorrência de mês ou de vencimento | Não existe | Duas operações separadas, "mover competência" e "alterar vencimento", mantendo o vínculo (seção 4) |
| Conciliação | `monthly_items.event_id`; sugestões só do mesmo mês e com valor exatamente igual (`routine.ts:216`) | Mesmo campo. Sugestões no mês anterior, atual e seguinte, com valor próximo; busca manual sem limite de data |
| Gerar meses futuros | Entradas: geradas e atualizadas a cada leitura dos bancos. Itens fixos por categoria: recriados no GET de `family/month` (escrita durante leitura) | Uma operação de escrita própria, idempotente, só insere. Nenhuma leitura escreve |
| Teto por categoria | Tabela `budgets` existe, só preenchida pela importação da planilha, sem tela | Tela de teto; o teto vale até ser trocado; comprometimento = realizado + previsto em aberto |
| Reservas | Caixinhas do Copiloto | Sem mudança. Fora do escopo |

---

## 2. Schema definitivo

Migration `028_recurrences.sql`, RLS e políticas no mesmo padrão de `income_rules`.

```sql
CREATE TABLE recurrences (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  purpose text NOT NULL CHECK (purpose IN ('expense','income')),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 180),
  category_id uuid,                        -- obrigatório para expense (CHECK abaixo)
  account_id uuid,                         -- conta de pagamento/recebimento
  expected_cents bigint NOT NULL CHECK (expected_cents > 0),
  frequency text NOT NULL CHECK (frequency IN ('day','week','month','year')),
  every integer NOT NULL DEFAULT 1 CHECK (every BETWEEN 1 AND 366),
  start_date date NOT NULL,                -- 1ª ocorrência e dia de referência
  end_date date CHECK (end_date IS NULL OR end_date >= start_date),
  paused boolean NOT NULL DEFAULT false,   -- pausa reversível ("Pausar previsão" das entradas)
  date_rule text NOT NULL DEFAULT 'exact'
    CHECK (date_rule IN ('exact','weekend_to_friday','fifth_business_day')),
  planning_offset smallint NOT NULL DEFAULT 0 CHECK (planning_offset IN (0,1)),
  match_text text,                         -- texto do extrato usado para sugerir a transação
  source_event_id uuid,                    -- transação que originou a série (imutável)
  replaces_id uuid,                        -- série anterior ("esta e as seguintes")
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, id),
  CHECK (purpose <> 'expense' OR (category_id IS NOT NULL AND planning_offset = 0)),
  FOREIGN KEY (household_id, category_id) REFERENCES categories(household_id, id),
  FOREIGN KEY (household_id, account_id) REFERENCES accounts(household_id, id),
  FOREIGN KEY (household_id, source_event_id) REFERENCES economic_events(household_id, id),
  FOREIGN KEY (household_id, replaces_id) REFERENCES recurrences(household_id, id),
  FOREIGN KEY (household_id, created_by) REFERENCES members(household_id, user_id)
);

CREATE TABLE recurrence_occurrences (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL,
  recurrence_id uuid NOT NULL,
  occurrence_date date NOT NULL,           -- data teórica pela regra: chave da idempotência
  expected_date date NOT NULL,             -- data efetiva prevista (após date_rule)
  monthly_item_id uuid NOT NULL,
  match_bank_transaction_id uuid,          -- sugestão de transação (não é conciliação)
  match_state text NOT NULL DEFAULT 'planned'
    CHECK (match_state IN ('planned','detected','review')),
  match_note text NOT NULL DEFAULT '',
  UNIQUE (recurrence_id, occurrence_date),
  UNIQUE (household_id, monthly_item_id),
  UNIQUE (household_id, id),
  FOREIGN KEY (household_id, recurrence_id) REFERENCES recurrences(household_id, id),
  FOREIGN KEY (household_id, monthly_item_id) REFERENCES monthly_items(household_id, id),
  FOREIGN KEY (household_id, match_bank_transaction_id) REFERENCES bank_transactions(household_id, id)
);
```

**Por que cada campo existe, e onde mora cada fato**

| Fato | Onde mora | Observação |
|---|---|---|
| Regra da série | `recurrences` | |
| Ocorrência gerada | linha em `recurrence_occurrences` | `(recurrence_id, occurrence_date)` único |
| Data efetiva prevista | `recurrence_occurrences.expected_date` | Precisa morar aqui: o salário de novembro tem item em dezembro, e `monthly_items.due_date` é obrigado a cair no mês do item |
| Mês de planejamento | `monthly_items.month` | |
| Vencimento | `monthly_items.due_date` | Despesa em dinheiro: data prevista. Cartão: vencimento da fatura. Entrada: vazio, como hoje |
| Valor previsto, status, pagamento, conciliação, cancelamento | `monthly_items` (`planned_cents`, `status`, `paid_*`, `event_id`, `archived`) | Nenhum desses fatos é copiado para a ocorrência |
| Sugestão de transação | `match_*` na ocorrência | Dado calculado, pode ser recalculado. A conciliação de verdade continua só em `event_id` |
| Sugestão recusada | `recurrence_decisions` (já existe) | Passa a guardar só recusas |

Os campos `date_rule`, `planning_offset`, `paused` e `match_*` existem porque as entradas já usam esses conceitos hoje.
`paused` não é o mesmo que `end_date`: ver 7.2.
Não há campo para reservas. `saving` fica fora do CHECK de `purpose` até haver decisão.

---

## 3. Semântica das datas por `purpose`

### 3.1. O que `budget_offset` faz hoje (confirmado em `bank-analysis.ts:228`)

Para uma regra de salário, a cada leitura dos bancos, para cada mês `M` desde `effective_month` até o mês atual + 2:

- `pay_month = M`: mês em que o dinheiro entra na conta.
- `expected_date`: com `receipt_mode='fixed'`, o dia da regra, antecipado para sexta quando cai em sábado ou domingo (`incomeDate`). Com `business_window`, o quinto dia útil do mês (`fifthBusinessDay`).
- `budget_month = M + budget_offset`: mês de planejamento que o dinheiro financia.
- O item de entrada (`monthly_items`) é criado ou reaproveitado **no `budget_month`**. Ele não tem `due_date`.
- O card "para o próximo mês" do Mês lista as ocorrências com `pay_month` = mês aberto e `budget_month` diferente (`routine.ts:207`).
- O realizado da entrada (a transação) entra em `state.ts` pela data da transação. Ou seja, a competência financeira continua sendo novembro.

Conclusão: `budget_offset` muda **só o mês de planejamento**, não a competência. Por isso o campo no núcleo se chama `planning_offset`, com os mesmos valores e o mesmo efeito. A migração copia o valor sem conversão.

### 3.2. As três datas, por tipo

| | Data efetiva prevista (`expected_date`) | Competência financeira | Mês de planejamento (`monthly_items.month`) | Vencimento (`due_date`) |
|---|---|---|---|---|
| Despesa em dinheiro ou conta | `occurrence_date` | mês de `expected_date` | igual à competência | `expected_date` |
| Despesa no cartão | data prevista da compra | mês da fatura, por `cardCompetence` e os ciclos do cartão | igual à competência | vencimento da fatura |
| Entrada | `occurrence_date` ajustada pela `date_rule` | mês de `expected_date` | competência + `planning_offset` | vazio |

Exemplos:

- Salário dia 25, `weekend_to_friday`, `planning_offset=1`. Em 25/10/2026 (domingo): data prevista 23/10, competência outubro, planejamento novembro.
- Aluguel dia 31, mensal, em dinheiro. Fevereiro de 2027: data prevista 28/02, competência e planejamento fevereiro, vencimento 28/02.
- Assinatura no cartão, cobrança prevista 28/11, cartão fecha dia 25 e vence dia 10. Competência e planejamento janeiro, vencimento 10/01.
- Cartão sem ciclo cadastrado: competência pelo mês da cobrança, com aviso. É a regra que já existe.

A competência financeira não é guardada: é derivada como na tabela. O núcleo grava `expected_date`, o mês de planejamento e o vencimento. As regras por tipo ficam num único módulo de domínio (seção 5.1), não espalhadas pelas telas.

### 3.3. Ocorrência no cartão (P5)

**Como o cartão é identificado.**
- `recurrences.account_id` aponta para uma conta da família.
- A política de despesa olha `accounts.kind`. Com `kind='card'`, a ocorrência segue as regras de cartão. Com qualquer outro tipo, ou sem conta, ela segue as regras de dinheiro.
- Na criação, a conta precisa existir e ser da família (a FK garante). A moeda precisa ser BRL.

**Competência da fatura.**
- É calculada por `cardCompetence` com as versões de ciclo daquele cartão (`card_cycle_versions`, migration 022, com `valid_from`), a partir de `expected_date`.
- Fica gravada no momento da geração: `monthly_items.month` é o mês da fatura e `due_date` é o vencimento dela.
- Cartão sem ciclo cadastrado: competência pelo mês da cobrança, com aviso. É a regra atual.

**Mudança de ciclo (L4).**
- É uma leitura sem escrita. Para cada ocorrência de cartão futura, em aberto e sem conciliação, o sistema recalcula a competência com as versões de ciclo atuais.
- Se o resultado difere de `monthly_items.month`, a ocorrência entra na lista "projeções afetadas pela mudança do cartão".
- "Atualizar compromissos futuros" aplica a operação de mover competência (seção 4) só nas ocorrências que você confirmar.
- Ocorrências realizadas ou conciliadas nunca entram na lista.

**Purpose e fluxo de caixa.**
- A ocorrência é `purpose='expense'`, conciliada com a compra (`card_purchase`).
- Não é `purpose='card'`: esse purpose é o planejamento da fatura e só concilia com `card_payment` (`routine.ts:337`).
- No fluxo de caixa, o motor soma a despesa de série no cartão dentro da fatura do mês, sem saída própria.

**Coerência na conciliação.**
- A transação precisa ser do tipo que a política aceita:
  - cartão: `card_purchase`;
  - dinheiro: `expense` ou `fee`.
- A conta também precisa bater: `economic_events.account_id` igual a `recurrences.account_id`, quando a série tem conta.
- Se a conta é outra, o servidor recusa por padrão. A tela explica a diferença e oferece "conciliar mesmo assim". Isso vai num campo explícito da requisição e fica registrado na auditoria.
- Conciliar nunca muda a competência. Se a transação cai em outro mês de fatura, a tela mostra o mês dela e oferece mover a ocorrência (seção 4), como ação separada.
- A unicidade de `monthly_items.event_id` continua impedindo que uma compra concilie duas ocorrências.

---

## 4. L2 e D3: mover competência e alterar vencimento são operações diferentes

Nenhuma das duas muda o schema, e o CHECK da migration 005 fica como está. As duas valem só para ocorrência que ainda pode ser editada: item não arquivado, `status='open'`, sem `paid_cents` e sem `event_id`.

### 4.1. Mover para outra competência

O que muda é o mês do item. O vencimento só muda se você escolher outro.

```sql
UPDATE monthly_items
   SET month = $novo_mes, due_date = $novo_vencimento,
       version = version + 1, updated_at = now()
 WHERE household_id = $1 AND id = $2 AND version = $3
   AND NOT archived AND status = 'open' AND paid_cents IS NULL AND event_id IS NULL
```

- Se o item tem vencimento, a tela **pede** um vencimento dentro do novo mês, ou que você remova o vencimento. O sistema nunca calcula esse vencimento sozinho.
- O CHECK é satisfeito porque mês e vencimento mudam no mesmo comando, e o banco avalia a linha já alterada. Hoje a competência só parece fixa porque a edição filtra pelo mês (`saveItemTx`, `WHERE … month=$9`). Isso é regra da API.
- **O que é preservado:**
  - A linha da ocorrência fica igual: mesmo `id`, mesma `occurrence_date`, mesma `expected_date` e mesmo `monthly_item_id`.
  - A geração usa a chave `(recurrence_id, occurrence_date)` e não olha o mês, então não recria a ocorrência no mês de origem.
  - O registro de auditoria `routine.move` guarda o mês de origem e o de destino.

### 4.2. Alterar vencimento

O que muda é só `due_date`, e sempre dentro do mês do item. Se você escolher uma data fora do mês, a tela recusa com a explicação e não oferece trocar a competência junto. Se quiser mudar de mês, você usa 4.1 por conta própria.

### 4.3. Limite aceito por enquanto (D3)

Uma despesa paga em dinheiro com vencimento fora do mês dela (dezembro com vencimento 05/01) continua não representável. As entradas não são afetadas, porque a data prevista delas mora em `expected_date`.

---

## 5. Núcleo: o que é compartilhado e o que não é

### 5.1. Compartilhado (um código só)

- `src/domain/recurrence.ts`, puro e testado:
  - **Calendário (P3):** dia, semana, mês, ano e a cada N. A k-ésima data é sempre calculada direto da âncora (`start_date`), nunca a partir da data anterior:
    - diária: `start + k·every` dias;
    - semanal: `start + 7·k·every` dias;
    - mensal: ano e mês de `start` mais `k·every` meses, no dia `min(dia de start, último dia do mês)`;
    - anual: ano de `start` mais `k·every`, no mesmo mês, no dia `min(dia de start, último dia do mês)`.

    Assim, o dia 31 vira 28/02 e volta a 31/03, sem "grudar" no 28.
    `date_rule` é aplicada depois, só para obter `expected_date`. Ela nunca alimenta a data seguinte.
  - **`date_rule`:** reaproveita `incomeDate` e `fifthBusinessDay`, que já existem em `src/domain/bank-analysis.ts`. As funções são movidas, não copiadas.
  - **Política por `purpose`:** um mapa único `{ expense, income }`. Cada política diz como calcular o mês de planejamento, o vencimento, os valores padrão do item e quais tipos de transação conciliam. As telas não perguntam o `purpose`; perguntam à política.
- `src/server/recurrences.ts`, com as operações:
  - geração idempotente (`sync`);
  - criação;
  - editar uma ocorrência;
  - esta e as seguintes;
  - encerrar;
  - cancelar;
  - mover competência;
  - alterar vencimento;
  - pausar e retomar;
  - cobertura;
  - sugestão e busca de transações.
- Duas perguntas diferentes, duas funções (decisão do ajuste 3):
  - `isRecurring(item)`: o item pertence a uma série.
  - `isFixedBill(item)`: `isRecurring(item)` e `purpose='expense'`. É a única regra de "conta fixa". Entradas recorrentes nunca são contas fixas.

### 5.2. Específico de cada módulo

| | Despesas | Entradas |
|---|---|---|
| Criação | Manual, ou a partir de uma transação aprovada | Pela tela de regra de recebimento dos Bancos, como hoje |
| Sugestão de transação | Por `match_text` (estabelecimento) e valor próximo | A regra atual: conta + `match_text`, ou crédito Wise na janela de dias úteis; `detected` só com data e valor exatos |
| Item já existente | Reaproveita o item da transação de origem | Reaproveita o item de entrada com o mesmo nome no mês de planejamento; se houver mais de um, não mexe (regra atual) |

---

## 6. Geração, edição e encerramento

### 6.1. Geração (`sync`) (P1)

Entrada: um intervalo `[from, through]`.
- Quem cria ou edita uma série usa `from = start_date`, para cobrir a série inteira.
- As demais chamadas usam `from` = início do mês anterior e `through` = fim do mês atual + 2, o mesmo horizonte das entradas hoje.
- Ao navegar para um mês distante, `through` passa a ser esse mês.

1. Abre uma transação com `pg_advisory_xact_lock(hashtext('recurrence-sync:' + família))`. Criar, editar, encerrar, pausar e mover usam a mesma trava.
2. Para cada série não pausada, calcula **todas as datas esperadas** dentro de `[max(from, start_date), min(through, end_date)]` pelo calendário da 5.1.
3. Lê as datas já existentes: `SELECT occurrence_date FROM recurrence_occurrences WHERE recurrence_id = $1 AND occurrence_date BETWEEN …`. Isso inclui canceladas, movidas e editadas, porque todas têm linha.
4. Cria só as que faltam (esperadas menos existentes): o item pela política e, em seguida, a ocorrência.
   - Lacunas antigas dentro do intervalo são recuperadas.
   - Canceladas nunca voltam, porque a linha delas existe.
   - Nenhuma linha existente sofre `UPDATE`.
5. **Ambiguidade das entradas:** quando o mês de planejamento tem mais de um item com o mesmo nome, a data é pulada, igual a hoje. Ela continua como lacuna e é tentada de novo no próximo sync. Isso aparece como cobertura `pending` para aquele mês.
6. **Concorrência:**
   - A trava serializa os syncs da mesma família.
   - Os únicos `(recurrence_id, occurrence_date)` e `(household_id, monthly_item_id)` são a segunda barreira: se algo escapar, a transação inteira é desfeita, sem item órfão.
   - Rodar duas vezes o mesmo intervalo produz o mesmo estado.
7. **Quem chama:**
   - criar ou editar uma série;
   - `POST recurrences/sync`, quando o app abre ou navega para um mês além do horizonte;
   - a leitura dos bancos, que hoje já gera as entradas;
   - `cron/reminders`, quando hospedado.
8. **Cobertura:** as leituras não escrevem. Uma série está coberta num mês quando todas as datas esperadas dela naquele mês têm linha. A resposta traz `recurrence_coverage: complete | pending`. Com `pending`, a tela avisa e oferece tentar de novo, e o Copiloto marca o valor como provisório.

**Sugestão de transação:** é um passo separado da geração. Recalcula só os campos `match_*`, a cada leitura dos bancos, como acontece hoje com `state` e `note`. Nunca toca no item nem na conciliação.

### 6.2. Edição

- **Uma ocorrência.** Edita o item, pelo fluxo atual. A geração nunca sobrescreve.
- **Cancelar uma.** `archived=true` no item. A ocorrência continua existindo e nunca volta. Apagar um item ligado vira cancelamento.
- **Esta e as seguintes, a partir de D (P4).** Vale para valor, frequência, intervalo, dia, categoria, conta, `date_rule` ou `planning_offset`. São duas chamadas.
  1. **Prévia, só leitura.** Lista as ocorrências da série com `occurrence_date >= D` em quatro grupos:
     - **substituídas:** em aberto e sem edição;
     - **com edição manual:** em aberto, mas o item é diferente do que a política geraria para aquela ocorrência. Conta como diferente: valor, nome, categoria, vencimento ou competência. A comparação é feita contra a série antiga, sem coluna nova. Se você editou para o mesmo valor que já estava, o resultado é idêntico de qualquer forma;
     - **preservadas:** realizadas, parciais ou conciliadas;
     - **canceladas:** continuam canceladas.

     A prévia devolve a `version` de cada item.
  2. **Aplicação.** Recebe a decisão de cada ocorrência com edição manual: `substituir` ou `manter`. Sem decisão para todas, a operação é recusada. Se alguma `version` mudou desde a prévia, a operação também é recusada e pede uma prévia nova. Em uma transação, com a trava:
     - a série antiga recebe `end_date = D − 1`;
     - nasce a série nova com `start_date = D` e `replaces_id` apontando para a antiga;
     - as **substituídas** e as marcadas como `substituir` são arquivadas;
     - as **preservadas** e as marcadas como `manter` ficam como estão. Se a data delas existe na série nova, o vínculo passa para a nova e o sync não cria duplicata. Se não existe (mudou a frequência ou o dia), elas continuam ligadas à série antiga como exceção;
     - roda o sync da série nova.

  As ocorrências antes de D não são tocadas. A interface mostra a prévia antes de confirmar, com a lista das exceções para você decidir uma por uma.
- **Encerrar em D.** Mesma prévia e mesma regra de decisão: `end_date = D − 1`, as substituídas são arquivadas, as editadas seguem a sua decisão e as realizadas são preservadas.
- **Pausar e retomar.** Muda só `paused`. Pausar não arquiva nada e não muda o passado. O sync não gera ocorrências para série pausada, e as telas escondem as ocorrências dela, igual a "Pausar previsão" hoje (7.2).
- **Mudar o ciclo do cartão (L4).** Detecção e atualização como em 3.3.

### 6.3. Mudanças aprovadas em relação ao comportamento atual das entradas

| Hoje | Com o núcleo | Decisão |
|---|---|---|
| Editar a regra do salário recalcula `expected_date` de **todos** os meses, inclusive os passados (`ON CONFLICT … DO UPDATE`, `bank-analysis.ts:321`). A tela só deixa mudar dia, valor e pausa; nome, destino, modo e início já são bloqueados (`bank-analysis.ts:193`) | Toda edição da regra vira "esta e as seguintes", e o passado fica como está | **D1, aprovada** |
| **Defeito:** se a pessoa renomeia o item de entrada de um mês, a próxima leitura dos bancos não acha o item pelo nome e cria **outro** item com o salário previsto. A ocorrência continua ligada ao antigo, e a entrada prevista fica em dobro naquele mês | A busca por nome só acontece ao criar uma ocorrência que ainda não existe. Ocorrência existente nunca cria item | **D2, aprovada.** Os duplicados que já existem são listados para revisão (7.4) e nada é apagado ou conciliado sozinho |

### 6.4. Testes de calendário e de série (P3)

- **Mensal no dia 31, começando em 31/01/2027:**
  - fevereiro cai em 28/02/2027;
  - março volta para 31/03;
  - abril cai em 30/04;
  - maio volta para 31/05.
- **Bissexto:**
  - mensal no dia 31 em 2028 cai em 29/02;
  - anual em 29/02/2028 cai em 28/02 em 2029, 2030 e 2031, e volta para 29/02 em 2032.
- **A cada N:**
  - a cada 2 semanas a partir de uma quinta, atravessando o mês e o ano;
  - a cada 3 meses a partir de 15/11, dando 15/02, 15/05 e 15/08;
  - a cada 2 meses a partir de 31/12, dando 29/02/2028 e depois 30/04, sem grudar no 29.
- **Várias no mesmo mês:**
  - semanal com 4 e com 5 ocorrências no mês (R$ 720 e R$ 900);
  - diária a cada 1 dia e a cada 3 dias.
- **Âncora estável:** calcular a 12ª data direto dá o mesmo resultado que gerar mês a mês. Mudar `date_rule` não altera `occurrence_date`.
- **Mudar a frequência a partir de D**, de mensal para semanal:
  - antes de D nada muda;
  - as datas antigas depois de D saem;
  - as novas começam em D;
  - uma realizada depois de D que não existe na série nova continua ligada à antiga.
- **Limites:**
  - `start_date` no meio do mês;
  - `end_date` inclusiva;
  - nenhuma data fora do intervalo.
- **Sync e lacunas:**
  - uma lacuna no meio do intervalo é recriada;
  - uma cancelada no meio do intervalo não volta;
  - uma série pausada não gera nada;
  - dois syncs simultâneos dão o mesmo resultado de um só;
  - uma falha no meio desfaz tudo, sem item órfão.
- **Prévia de "esta e as seguintes":**
  - classifica corretamente substituída, editada, preservada e cancelada;
  - aplicar sem decisão para todas as editadas é recusado;
  - `version` alterada desde a prévia é recusada;
  - `manter` preserva os valores e não duplica a data.

---

## 7. Migração das entradas

### 7.1. Antes de qualquer troca: testes do comportamento atual

São escritos contra o código atual, ainda sem o núcleo, e passam a fixar o comportamento esperado:

1. Salário com dia fixo: data prevista, antecipação de sábado e de domingo para sexta, mês de planejamento com `budget_offset` 0 e 1.
2. Janela de dias úteis: quinto dia útil e crédito Wise aceito como candidato.
3. Detecção:
   - um crédito igual em data e valor dá `detected`;
   - data ou valor diferente dá `review` com a nota de divergência;
   - dois créditos dão `review` com "mais de um crédito";
   - nenhum crédito dá `planned`;
   - transação pendente ou alterada nunca dá `detected`.
4. Recebimento parcial ou divergente: o item fica `partial` pelo fluxo de conferência e a ocorrência continua `review`.
5. Reaproveitamento: um item de entrada com o mesmo nome no mês é reaproveitado; dois itens com o mesmo nome não são tocados.
6. Edição de uma ocorrência: o valor editado no item sobrevive a uma nova leitura dos bancos.
7. Card "para o próximo mês" e `funding` dos itens no Mês: os mesmos textos e valores.
8. Copiloto e projeção:
   - `incomeDetected` e `receiptLate` (`copilot-reads.ts`) dão os mesmos resultados;
   - os recebimentos previstos (`projection-reads-plan.ts:58`) também.
9. `copyMonth` continua sem copiar a entrada prevista de regra que ainda não chegou (`routine.ts:398`).
10. `reserve_plans`: confirmar que `occurrence_id` nunca é gravado. O código só faz `INSERT` sem essa coluna (`reserves.ts:196`), então hoje todos os valores são nulos. A migração repassa a FK mesmo assim.
11. Pausa: uma regra pausada não gera ocorrências e as ocorrências dela somem do card de recebimentos, do funding, da projeção e do Copiloto. Todas essas leituras filtram `r.enabled`. Ao reativar, tudo volta.

### 7.2. Migração dos dados (P2)

A migração tem duas partes separadas: o schema (migration 028) e os dados (`scripts/migrate-recurrences.ts`). Os dados ficam fora da migration de schema para poderem ser conferidos e repetidos.

**Mapeamento, com os mesmos `id`s:**

| Origem | Destino |
|---|---|
| `income_rules.id` | `recurrences.id` |
| `purpose` | `'income'` |
| `frequency`, `every` | `'month'`, `1` |
| `effective_month` + `day` | `start_date` = dia `day` de `effective_month`. `day` é sempre de 1 a 28, então a data existe |
| `receipt_mode` `fixed` / `business_window` | `date_rule` `weekend_to_friday` / `fifth_business_day` |
| `budget_offset` | `planning_offset`, mesmo valor |
| `match_text`, `account_id`, `label`, `expected_cents`, `created_by`, `created_at` | os mesmos campos |
| `enabled` | `paused = NOT enabled`. **`end_date` fica vazio** |
| `income_occurrences.id` | `recurrence_occurrences.id` |
| `rule_id` | `recurrence_id` |
| `pay_month` + `day` da regra | `occurrence_date` = dia `day` de `pay_month` |
| `expected_date`, `monthly_item_id` | os mesmos campos |
| `bank_transaction_id`, `state`, `note` | `match_bank_transaction_id`, `match_state`, `match_note` |
| `budget_month` | não é copiado: precisa ser igual a `monthly_items.month`, e a conferência verifica |

**Por que pausa não vira `end_date`:**
- Na tela, "Pausar previsão" e "Ativar previsão" são **reversíveis** (`family-banks.tsx:793`). Pausar esconde todas as ocorrências da regra, inclusive as passadas, porque as leituras filtram `r.enabled`.
- Um `end_date` seria definitivo e manteria o passado visível. As duas coisas mudariam o comportamento.
- Por isso o campo `paused` existe: ele tem uso real hoje.

**Execução, em uma transação:**
1. Insere com `ON CONFLICT (id) DO NOTHING`. Isso só serve para poder repetir a migração; não garante nada sozinho.
2. Roda a conferência da 7.3 na mesma transação. **Qualquer divergência dispara uma exceção, e tudo é desfeito.**
   - Isso inclui um `id` que já existia no destino com conteúdo diferente, que o `ON CONFLICT` teria escondido.
   - O script mostra a lista das divergências e encerra com erro.
3. `reserve_plans.occurrence_id` passa a referenciar `recurrence_occurrences(id)` (troca de FK na migration 028). Como os ids são os mesmos, nenhum valor muda.
4. Nada é apagado. As tabelas antigas continuam sendo lidas e escritas pelo código atual até a troca de consumidores (7.4), que é um passo separado.

### 7.3. Conferência, que bloqueia a troca

É uma consulta `FULL OUTER JOIN` entre origem e destino, nos dois sentidos, comparando campo a campo pelo mapeamento acima. Ela falha se encontrar:

- uma regra ou ocorrência de origem sem destino, ou um destino de entrada sem origem;
- qualquer campo mapeado diferente;
- `monthly_items.month` da ocorrência diferente do `budget_month` antigo;
- `occurrence_date` cujo mês difere de `pay_month`;
- `expected_date` diferente do que `date_rule` produz a partir de `occurrence_date`. Diferença aqui é registrada como divergência para revisão, e não ajustada: valores antigos podem ter vindo de regras com outro dia;
- contagens por família diferentes.

A mesma conferência roda:
- nos testes, com cenários de regra ativa, pausada, janela de dias úteis, `budget_offset` 0 e 1 e mês ambíguo sem ocorrência;
- de novo, imediatamente antes da troca de consumidores.

### 7.4. Troca dos consumidores, em ordem

1. Os testes da 7.1 são duplicados para rodar sobre o núcleo. Os dois conjuntos precisam dar o mesmo resultado. As exceções são só D1 e D2, cobertas por testes próprios que mostram a diferença.
2. A conferência da 7.3 roda no seu banco. Sem divergência, segue. Com divergência, para e mostra a lista.
3. Uma consulta lista os possíveis duplicados de D2: item de entrada não arquivado, com o mesmo nome da regra, no mesmo mês de planejamento, sem ocorrência, enquanto a ocorrência daquele mês aponta para outro item. A lista é mostrada para revisão, e nada é apagado nem conciliado sozinho.
4. Detecção e geração em `bank-analysis.ts` passam a usar o núcleo.
5. As leituras passam para as tabelas novas:
   - `routine.ts` (recebimentos e funding);
   - `projection.ts`;
   - `projection-reads-plan.ts`;
   - `copilot-reads.ts`;
   - `banks.ts` (`readIncomeRules`).
6. A tela de regra de recebimento (`family-banks.tsx`, `income/rule`) passa a gravar no núcleo, com pausa e "esta e as seguintes".
7. Os testes que inserem direto em `income_rules` e `income_occurrences` (6 arquivos em `tests-js/`) passam a usar o núcleo.
8. As tabelas antigas ficam preservadas, sem nenhum consumidor. Um teste com `grep` garante que nenhum arquivo em `src/` e `app/` cita `income_rules` ou `income_occurrences`, além do script de migração.

---

## 8. Integração financeira (etapa 4)

**Teto por categoria (`budgets`).**
- A tela grava o teto a partir de um mês.
- A leitura usa a linha mais recente com mês igual ou anterior ao consultado.
- Criar uma série nunca escreve em `budgets`.

**Comprometimento da categoria no mês.**
- Soma o realizado do mês (transações pela competência, como em `state.ts:405`) com o previsto em aberto: `planned − paid`, só de itens sem `event_id`, sem arquivados e sem derivados.
- Uma ocorrência conciliada entra uma vez só, pela transação.
- Se o comprometimento passa do teto, a tela sinaliza.

**Copiloto.**
- Previsto em aberto em dinheiro: vira saída no vencimento.
- No cartão: entra dentro da fatura.
- Conciliado: não gera saída.
- O dia a dia exclui a transação conciliada, e não mais a categoria inteira (`projection-reads-everyday.ts:40`).
- Recorrência adivinhada (`detectRecurrences`) deixa de projetar sozinha e vira só sugestão.

**Conciliação.**
- Sugestões no mês anterior, no atual e no seguinte, com valor próximo. Hoje só aparece valor exatamente igual, então R$ 165 contra R$ 150 nunca é sugerido.
- Busca manual (`GET routine/candidates?item=&q=&from=&to=`), somente leitura, até 50 resultados. Filtra por família, moeda e tipo compatível, e exclui transações já vinculadas.
- A gravação continua no `routine/check`, que já valida família, moeda, tipo e duplicidade (`routine.ts:327`).

---

## 9. O que deixa de ser usado ou é removido

| Item | Destino |
|---|---|
| `categories.fixed` como regra de fixo | Deixa de ser lido. A coluna fica |
| Itens derivados por categoria (`deriveFixedItems`, escrita no GET) | Removido. Os itens antigos ficam como histórico e não entram no comprometimento |
| `cost_type='fixed'` | Só leitura, marcado como legado, com "Transformar em conta fixa". Não gera nada sozinho |
| Palpite por nome de categoria e de item (`dashboard.ts:9`) | Removido |
| `detectRecurrences` na projeção | Removido. `monthlyCandidates` fica como fonte de sugestões |
| `recurrence_decisions` com `confirm` | Os 3 "Sim" aparecem como sugestão para confirmar um por um, com checagem de conflito. As recusas continuam suprimindo sugestões |
| `src/server/recurrences.ts` (o do painel antigo) e as rotas `recurrences`, `recurrences/decision` | Substituídos pelas operações do núcleo e pelas rotas de sugestão |
| Painel "Contas que se repetem" (`recurring-panel.tsx`, `recurring-row.tsx`, `use-recurring.ts`) | Já removido no disco, sem commit |
| `income_rules` e `income_occurrences` | Ficam no banco sem nenhum consumidor depois da etapa 3. Um teste garante isso (7.4). Apagar as tabelas fica para uma migration futura |
| `incomeDate` e `fifthBusinessDay` em `bank-analysis.ts` | Movidos para `src/domain/recurrence.ts` |
| `copyMonth` | Continua. Passa a ignorar itens ligados a séries |

---

## 10. Etapas e critério de saída

| Etapa | Entrega | Termina quando |
|---|---|---|
| 1. Núcleo | Migration 028 (só as tabelas), domínio puro, `sync`, operações, testes da 6.4 | Testes de calendário, idempotência, concorrência, prévia e edição, encerramento, pausa e mudança de competência passando. Nenhuma tela muda |
| 2. Despesas fixas | Protótipos das telas de criação, edição e acompanhamento; depois criação manual e a partir de transação, edição, encerramento, conciliação ampliada e coerência de conta (3.3) | Testes de despesa e de cartão passando; `isFixedBill` em uso nas telas |
| 3. Entradas | Testes do comportamento atual (7.1) **antes de qualquer troca**, migração dos dados, conferência (7.3) e troca dos consumidores (7.4) | Os dois conjuntos de testes dão o mesmo resultado, fora D1 e D2; conferência sem divergência; tabelas antigas sem consumidor |
| 4. Integração | Teto, comprometimento, Mês, Panorama, Copiloto | Nenhuma dupla contagem nos testes de cartão, conciliação e comprometimento |

---

## 11. Decisões registradas

| | Decisão |
|---|---|
| A | Teto por categoria entra nesta entrega |
| B | `cost_type='fixed'` antigo fica no grupo atual como legado, sem gerar recorrência, até ser transformado |
| C | A detecção por comportamento vira só sugestão; recusas anteriores continuam suprimindo sugestões |
| D1 | Edição de regra de entrada vira "esta e as seguintes" |
| D2 | O defeito do item renomeado é corrigido; os duplicados existentes vão para revisão manual |
| D3 | O vencimento continua dentro do mês do item. Mover competência e alterar vencimento são operações separadas, e nenhuma muda a outra implicitamente |
| L1 | Transação pendente precisa ser aprovada antes de virar conta fixa. A tela explica e leva à aprovação |
| L3 | Conciliação com sugestões em janela de 3 meses e busca manual sem limite de data |
| L4 | Mudança de ciclo do cartão mostra as projeções afetadas e oferece atualizar, sem mexer em realizadas |
| L5 | Ocorrências de meses distantes são criadas por uma operação de escrita separada, idempotente, sem agendador novo |
| L6 | Recorrências diárias aparecem agrupadas por série, com total do mês, e se expandem para edição |
| L7 | Só BRL |

Não há decisões pendentes.

**Estruturas novas:** as duas tabelas, só isso.
**Campos novos com justificativa:**
- `paused`: hoje a pausa reversível das entradas existe e esconde o histórico, e `end_date` não tem esse comportamento;
- `date_rule`, `planning_offset` e `match_*`: comportamento atual das entradas.
