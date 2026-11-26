import type { Database } from "./db.ts";
import { asUser } from "./db.ts";
import type { Identity } from "./auth.ts";
import { analyzePending, pendingRows } from "./pending.ts";
import {
  economicEffect,
  savings,
  type Kind,
  type Currency,
} from "../domain/finance.ts";
import {
  CARD_LOOKBACK_MONTHS,
  budgetMonthOf,
  competenceOf,
  loadCardCompetence,
  readCardEvents,
  readOtherCurrencyCardSpend,
} from "./card-competence.ts";
import { merchantKey, resolveCategory } from "./assisted.ts";
import { readAutoCountedChecking, readPendingCardPurchases } from "./realized-spend.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import { eventName } from "../domain/event-name.ts";
import { fixedEventIds } from "./fixed-events.ts";
import { readCommitments } from "./budgets.ts";
import { readBankCover, type BankCover } from "./fixed-bank-cover.ts";
import { UNCATEGORIZED } from "../domain/budget.ts";
import { AUTO_OUTFLOW_SQL } from "../domain/bank-analysis.ts";
import { scheduledSql, settledSql, settledToday } from "./bank-settled.ts";
export type EventRow = {
  id: string;
  kind: Kind;
  transaction_date: string;
  description: string;
  display_name: string | null;
  alias_name?: string | null;
  amount_cents: string;
  currency: Currency;
  account_id: string;
  counter_account_id: string | null;
  counter_currency: Currency | null;
  counter_amount_cents: string | null;
  category_id: string | null;
  category_name: string | null;
  tag_id: string | null;
  tag_name: string | null;
  account_name: string;
  created_by: string;
  sources: unknown[];
  // Fase 4 de docs/SPEC-FATOS-CARTAO.md: removido (fora dos totais), criado
  // pelo app a partir do banco, e removido porque o banco deixou de trazer.
  cancelled_at: string | null;
  cancel_reason: string | null;
  related_event_id: string | null;
  auto: boolean;
  gone: boolean;
};
type AccountView = {
  observed_balance_cents?: string | null;
  observed_date?: string | null;
  observed_source?: string;
  id: string;
  name: string;
  institution: string;
  currency: Currency;
  kind: string;
  opening_cents: string | null;
  opening_date: string | null;
  balance_cents: string | null;
};
type BatchView = {
  context: { reconciliation?: { status: string; date: string } };
  id: string;
  account_id: string;
  status: string;
  parser: string;
  created_at: Date;
  filename: string;
  row_count: number;
  pending_count: number;
};
export async function readState(
  db: Database,
  user: Identity,
  month: string,
  currency: Currency,
  accountId?: string,
  categoryId?: string,
  withEvidence = true,
) {
  return asUser(db, user.userId, async (tx) => {
    const accounts = (
      await tx.query<AccountView>(
        "SELECT a.id,a.name,a.institution,a.currency,a.kind,a.opening_cents::text,a.opening_date::text,CASE WHEN a.opening_cents IS NULL THEN NULL ELSE (a.opening_cents+coalesce(sum(l.amount_cents),0))::text END AS balance_cents FROM accounts a LEFT JOIN ledger_entries l ON l.account_id=a.id WHERE a.household_id=$1 GROUP BY a.id ORDER BY a.name",
        [user.familyId],
      )
    ).rows;
    for (const account of accounts) {
      const observed = (
        await tx.query<{ cents: string; date: string; filename: string }>(
          "SELECT b.context->'closing'->>'cents' AS cents,b.context->'closing'->>'date' AS date,f.filename FROM import_batches b JOIN source_files f ON f.id=b.source_id WHERE b.household_id=$1 AND b.account_id=$2 AND b.context->'closing'->>'cents' IS NOT NULL AND jsonb_array_length(b.checks)>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.checks) c WHERE (c->>'passed')::boolean=false) ORDER BY b.context->'closing'->>'date' DESC LIMIT 1",
          [user.familyId, account.id],
        )
      ).rows[0];
      if (observed) {
        account.observed_balance_cents = observed.cents;
        account.observed_date = observed.date;
        account.observed_source = observed.filename;
      }
    }
    const importTotals = (
      await tx.query<{
        rows: number;
        recorded: number;
        pending: number;
        files: number;
      }>(
        "SELECT (SELECT count(*)::integer FROM staged_transactions WHERE household_id=$1) AS rows,(SELECT count(*)::integer FROM event_sources WHERE household_id=$1) AS recorded,(SELECT count(*)::integer FROM staged_transactions s WHERE household_id=$1 AND NOT EXISTS(SELECT 1 FROM event_sources es WHERE es.staged_id=s.id)) AS pending,(SELECT count(*)::integer FROM source_files WHERE household_id=$1) AS files",
        [user.familyId],
      )
    ).rows[0];
    const bankRows = (
      await tx.query<{
        id: string;
        batch_id: string;
        ordinal: number;
        transaction_date: string;
        description: string;
        amount_cents: string;
        currency: Currency;
        filename: string;
        account_name: string;
        category_name: string | null;
        recorded: boolean;
        duplicate_hint: boolean;
        event_id: string | null;
        event_kind: string | null;
      }>(
        "SELECT s.id,s.batch_id,s.ordinal,s.transaction_date::text,s.description,s.amount_cents::text,s.currency,f.filename,a.name AS account_name,c.name AS category_name,EXISTS(SELECT 1 FROM event_sources es WHERE es.staged_id=s.id) AS recorded,s.duplicate_hint,(SELECT es.event_id FROM event_sources es WHERE es.staged_id=s.id LIMIT 1) AS event_id,(SELECT e.kind FROM event_sources es JOIN economic_events e ON e.id=es.event_id WHERE es.staged_id=s.id LIMIT 1) AS event_kind FROM staged_transactions s JOIN import_batches b ON b.id=s.batch_id JOIN source_files f ON f.id=b.source_id JOIN accounts a ON a.id=b.account_id LEFT JOIN categories c ON c.id=s.category_id WHERE s.household_id=$1 AND s.currency=$2 AND s.transaction_date>=$3::date AND s.transaction_date<($3::date+interval '1 month') AND ($4::uuid IS NULL OR b.account_id=$4) AND ($5::uuid IS NULL OR s.category_id=$5) ORDER BY s.transaction_date DESC,s.batch_id,s.ordinal",
        [user.familyId, currency, month, accountId ?? null, categoryId ?? null],
      )
    ).rows;
    const tagRows = (
      await tx.query<{
        id: string;
        category_id: string;
        name: string;
        uses: number;
      }>(
        "SELECT t.id,t.category_id,t.name,(SELECT count(*)::int FROM economic_events e WHERE e.household_id=t.household_id AND e.tag_id=t.id) + (SELECT count(*)::int FROM bank_transactions b WHERE b.household_id=t.household_id AND b.tag_id=t.id AND b.status='pending') AS uses FROM category_tags t WHERE t.household_id=$1",
        [user.familyId],
      )
    ).rows.sort((a, b) => a.name.localeCompare(b.name, "pt"));
    const categories = (
      await tx.query<{
        id: string;
        name: string;
        essential: boolean;
        fixed: boolean;
        color_index: number | null;
      }>(
        "SELECT id,name,essential,fixed,color_index FROM categories WHERE household_id=$1 ORDER BY name",
        [user.familyId],
      )
    ).rows.map((c) => ({
      ...c,
      tags: tagRows
        .filter((t) => t.category_id === c.id)
        .map((t) => ({ id: t.id, name: t.name, uses: t.uses })),
    }));
    const planning = (
      await tx.query<{
        sheet: string;
        cell: string;
        label: string;
        purpose: string;
        planned_cents: string | null;
        actual_cents: string | null;
        derived: boolean;
        error: string | null;
        actual_error: string | null;
        notes: string;
        filename: string;
        category_name: string;
      }>(
        "SELECT p.sheet,p.cell,p.label,p.purpose,p.planned_cents::text,p.actual_cents::text,p.derived,p.error,p.actual_error,p.notes,f.filename,c.name AS category_name FROM planning_lines p JOIN planning_sources f ON f.id=p.source_id JOIN categories c ON c.id=p.category_id WHERE p.household_id=$1 AND p.month=$2 AND $3='BRL' ORDER BY p.sheet,p.cell",
        [user.familyId, month, currency],
      )
    ).rows;
    const events = (
      await tx.query<EventRow>(
        "SELECT e.id,e.kind,e.transaction_date::text,e.description,e.display_name,ma.alias AS alias_name,e.amount_cents::text,e.currency,e.account_id,e.counter_account_id,e.counter_currency,e.counter_amount_cents::text,e.category_id,c.name AS category_name,e.tag_id,t.name AS tag_name,a.name AS account_name,e.created_by,e.cancelled_at::text,e.cancel_reason,e.related_event_id,EXISTS(SELECT 1 FROM bank_transactions ab WHERE ab.event_id=e.id AND ab.household_id=e.household_id AND ab.auto_recorded) AS auto,EXISTS(SELECT 1 FROM bank_transactions gb WHERE gb.event_id=e.id AND gb.household_id=e.household_id AND gb.auto_recorded AND gb.missing) AS gone,coalesce((SELECT json_agg(json_build_object('file',f.filename,'locator',s.locator,'original_description',s.original_description,'bank_id',s.bank_id)) FROM event_sources es JOIN staged_transactions s ON s.id=es.staged_id JOIN import_batches b ON b.id=s.batch_id JOIN source_files f ON f.id=b.source_id WHERE es.event_id=e.id),'[]')::jsonb || coalesce((SELECT jsonb_agg(jsonb_build_object('file','Meu Pluggy','locator',bt.remote_id,'source_kind','bank')) FROM bank_transactions bt WHERE bt.event_id=e.id AND bt.household_id=e.household_id),'[]'::jsonb) AS sources FROM economic_events e JOIN accounts a ON a.id=e.account_id LEFT JOIN categories c ON c.id=e.category_id LEFT JOIN category_tags t ON t.id=e.tag_id AND t.household_id=e.household_id LEFT JOIN merchant_aliases ma ON ma.household_id=e.household_id AND ma.key=merchant_key(e.description) WHERE e.household_id=$1 AND (e.currency=$2 OR e.counter_currency=$2) AND e.transaction_date>=$3::date AND e.transaction_date<($3::date+interval '1 month') AND ($4::uuid IS NULL OR EXISTS(SELECT 1 FROM ledger_entries l WHERE l.event_id=e.id AND l.account_id=$4)) AND ($5::uuid IS NULL OR e.category_id=$5) ORDER BY e.transaction_date DESC,e.created_at DESC",
        [user.familyId, currency, month, accountId ?? null, categoryId ?? null],
      )
    ).rows.map((event) => {
      if (
        (accountId && event.counter_account_id === accountId) ||
        event.currency !== currency
      ) {
        return {
          ...event,
          amount_cents:
            event.counter_amount_cents ??
            (-BigInt(event.amount_cents)).toString(),
          currency,
          account_name:
            accounts.find((a) => a.id === event.counter_account_id)?.name ??
            event.account_name,
        };
      }
      return event;
    });
    const fixedIds = await fixedEventIds(
      tx,
      user.familyId,
      events.map((e) => e.id),
    );
    let income = 0n,
      expense = 0n;
    // Composição do "Já gastou" (soma = expense): o que já saiu da conta, o
    // que está agendado (data depois de hoje) e o que está na fatura do cartão
    // (sai da conta quando a fatura for paga).
    const today = settledToday();
    let expenseLeft = 0n,
      expenseScheduled = 0n,
      expenseCard = 0n;
    const addCash = (date: string, value: bigint) => {
      if (date > today) expenseScheduled += value;
      else expenseLeft += value;
    };
    const spending = new Map<string, bigint>();
    // Parte de `spending` que é saída agendada no banco e ainda não saiu.
    const scheduledSpending = new Map<string, bigint>();
    // Contas fixas já pagas por uma linha do banco: deixam de ser "a pagar"
    // (budgets) e a linha usa a categoria da conta fixa (escolha do usuário).
    const bankCover =
      currency === "BRL"
        ? await readBankCover(tx, user.familyId, [month.slice(0, 7)])
        : new Map<string, BankCover & { category_id: string | null }>();
    const coverCategory = new Map(
      [...bankCover.values()]
        .filter((c) => c.category_id !== null)
        .map((c) => [c.bank_transaction_id, c.category_id as string]),
    );
    // Linhas do gasto por categoria que NÃO estão em `events` (cartão por
    // competência, compra pendente do banco, débito automático): o detalhe do
    // teto lista cada uma em vez de agrupar a diferença.
    const spendingLines: {
      category_id: string;
      source: "card" | "card_pending" | "auto" | "scheduled";
      description: string;
      name?: string;
      account_name: string;
      transaction_date: string;
      amount_cents: string;
    }[] = [];
    // Lançamentos em conta de cartão pesam pela competência (mês de vencimento
    // da fatura), não pela data da compra; a timeline acima não muda.
    const cardAccounts = new Set(
      accounts.filter((a) => a.kind === "card").map((a) => a.id),
    );
    for (const event of events) {
      if (cardAccounts.has(event.account_id)) continue;
      // Removido: continua na lista, fora dos totais.
      if (event.cancelled_at) continue;
      const effect = economicEffect(event.kind, BigInt(event.amount_cents));
      income += effect.income;
      expense += effect.expense;
      addCash(event.transaction_date, effect.expense);
      // Sem categoria também entra (UNCATEGORIZED), para a soma fechar com o total.
      const catKey = event.category_id ?? UNCATEGORIZED;
      spending.set(catKey, (spending.get(catKey) ?? 0n) + effect.expense);
    }
    // Despesa de cartão por COMPETÊNCIA. Compra pendente ou aprovada pesa no
    // mês de VENCIMENTO da fatura (cardCompetence: fatura do banco, vencimento
    // registrado, versão do ciclo vigente na compra). Sem competência
    // determinável, a compra conta no mês da própria compra (estimado). O
    // cartão só é sinalizado em cardBudgetUnconfigured quando NÃO tem nenhuma
    // versão de ciclo; uma compra anterior ao início do histórico conta no mês
    // da compra sem aviso. A janela cobre parcelas lançadas meses depois.
    const competence = await loadCardCompetence(tx, user.familyId);
    const cardEvents = await readCardEvents(tx, competence, {
      familyId: user.familyId,
      month,
      currency,
      accountId,
      categoryId,
    });
    // Pendências de cartão e de conta corrente vêm dos leitores compartilhados
    // (realized-spend.ts): uma única regra de inclusão para todas as telas.
    const monthStart = month.slice(0, 7);
    const cardPurchases =
      currency === "BRL"
        ? await readPendingCardPurchases(tx, {
            familyId: user.familyId,
            from: shiftMonth(monthStart, -CARD_LOOKBACK_MONTHS) + "-01",
            to: shiftMonth(monthStart, 1) + "-01",
            accountId,
          })
        : [];
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));
    // Regras de categoria aprendidas (merchant_rules). Carregadas uma vez e
    // passadas a resolveCategory para a categoria derivada de cartão/PIX
    // respeitar o que o usuário ensinou, antes de cair na regex fixa.
    const merchantRules =
      currency === "BRL"
        ? (
            await tx.query<{ match_text: string; category_name: string }>(
              "SELECT match_text,category_name FROM merchant_rules WHERE household_id=$1",
              [user.familyId],
            )
          ).rows
        : [];
    // Cartões SEM nenhuma versão de ciclo cadastrada: a competência nunca é
    // derivável, então a compra conta no mês da data da compra (estimado) e a
    // tela avisa para cadastrar o fechamento. Uma compra anterior ao início do
    // histórico de um cartão QUE TEM ciclo também fica estimada, mas não gera
    // aviso: o cartão já está configurado.
    const cardBudgetUnconfigured = new Set<string>();
    const hasCycleVersions = (accountId: string) =>
      (competence.versions.get(accountId)?.length ?? 0) > 0;
    // Divergência explicada (Opção Y): o quanto deste mês vem de compras de
    // cartão que VENCEM aqui mas cuja data de compra é de outro mês (logo NÃO
    // estão na timeline deste mês). A tela usa isto para explicar por que o
    // total é maior que os itens visíveis.
    // `month` aqui chega como "YYYY-MM-01" (data); o helper devolve "YYYY-MM".
    const monthKey = month.slice(0, 7);
    let cardDueOtherMonthCents = 0n;
    const cardDueOtherMonthItems: {
      description: string;
      name: string;
      account_name: string;
      transaction_date: string;
      amount_cents: string;
      category: string;
    }[] = [];
    // Conflito de competência (cardCompetence.conflict): a fatura veio
    // identificada pelo banco ou com vencimento declarado, mas o ciclo
    // cadastrado apontaria outro mês. Só sinaliza, nunca muda o cálculo; o
    // mês da fatura (que entra no total) segue sendo o que o banco informou.
    const cardCompetenceConflict = new Set<string>();
    for (const e of cardEvents) {
      if (e.budget.month !== monthKey) continue;
      if (e.competence.conflict) cardCompetenceConflict.add(e.competence.month!);
      if (e.budget.estimated && !hasCycleVersions(e.account_id))
        cardBudgetUnconfigured.add(e.account_id);
      const effect = economicEffect(e.kind, BigInt(e.amount_cents));
      income += effect.income;
      expense += effect.expense;
      expenseCard += effect.expense;
      const catKey = e.category_id ?? UNCATEGORIZED;
      spending.set(catKey, (spending.get(catKey) ?? 0n) + effect.expense);
      if (effect.expense)
        spendingLines.push({
          category_id: catKey,
          source: "card",
          description: e.description,
          name: eventName(e),
          account_name: e.account_name,
          transaction_date: e.transaction_date,
          amount_cents: effect.expense.toString(),
        });
      if (effect.expense && e.transaction_date.slice(0, 7) !== monthKey) {
        cardDueOtherMonthCents += effect.expense;
        cardDueOtherMonthItems.push({
          description: e.description,
          name: eventName(e),
          account_name: e.account_name,
          transaction_date: e.transaction_date,
          amount_cents: effect.expense.toString(),
          category:
            categories.find((x) => x.id === e.category_id)?.name ??
            "Sem categoria",
        });
      }
    }
    for (const p of cardPurchases) {
      const budget = budgetMonthOf(
        competenceOf(competence, {
          account_id: p.local_account_id,
          bank_account_id: p.bank_account_id,
          transaction_date: p.transaction_date,
          card_meta: p.card_meta,
        }),
        p.transaction_date,
      );
      if (budget.month !== monthKey) continue;
      // Categoria pela regra aprendida ou pela descrição; sem match de categoria
      // existente, vai para "uncategorized" para a soma fechar com o total.
      const categoryName = resolveCategory(merchantRules, p.description).name;
      const catId =
        coverCategory.get(p.id) ??
        categoryIdByName.get(categoryName) ??
        "uncategorized";
      // Filtro de categoria da tela: a compra pendente só conta quando a
      // categoria resolvida é a filtrada (a query de banco não a conhece).
      if (categoryId && catId !== categoryId) continue;
      // Cartão sem nenhum ciclo: conta no mês da compra e avisa. Compra
      // anterior ao início do histórico de um cartão com ciclo não avisa.
      if (budget.estimated && !hasCycleVersions(p.local_account_id))
        cardBudgetUnconfigured.add(p.local_account_id);
      const value = -BigInt(p.amount_cents); // despesa positiva (estorno abate)
      expense += value;
      expenseCard += value;
      spending.set(catId, (spending.get(catId) ?? 0n) + value);
      spendingLines.push({
        category_id: catId,
        source: "card_pending",
        description: p.description,
        account_name: p.account_name,
        transaction_date: p.transaction_date,
        amount_cents: value.toString(),
      });
      // Compra que vence neste mês mas foi feita em outro -> não está na
      // timeline deste mês. Guarda para a explicação da divergência (Opção A
      // com detalhe expansível).
      if (p.transaction_date.slice(0, 7) !== monthKey) {
        cardDueOtherMonthCents += value;
        cardDueOtherMonthItems.push({
          description: p.description,
          name: p.description,
          account_name: p.account_name,
          transaction_date: p.transaction_date,
          amount_cents: value.toString(),
          category: categoryName,
        });
      }
    }
    cardDueOtherMonthItems.sort((a, b) =>
      a.transaction_date < b.transaction_date ? 1 : -1,
    );
    // Movimentos de conta corrente que contam sem aprovação (regra e
    // documentação em readAutoCountedChecking): inclui a exclusão de linhas
    // ligadas a uma reserva, que nunca são consumo.
    const autoCounted =
      currency === "BRL"
        ? await readAutoCountedChecking(tx, {
            familyId: user.familyId,
            from: monthStart + "-01",
            to: shiftMonth(monthStart, 1) + "-01",
          })
        : [];
    for (const p of autoCounted) {
      const cents = BigInt(p.amount_cents);
      if (cents < 0n) {
        const value = -cents; // despesa positiva
        expense += value;
        addCash(p.transaction_date, value);
        const categoryName = resolveCategory(merchantRules, p.description).name;
        const catId =
          coverCategory.get(p.id) ??
          categoryIdByName.get(categoryName) ??
          "uncategorized";
        spending.set(catId, (spending.get(catId) ?? 0n) + value);
        // Agendado no banco (sai depois de hoje): no teto conta como "a pagar"
        // até o banco confirmar a saída. O total do mês não muda.
        const later = p.transaction_date > today;
        if (later) scheduledSpending.set(catId, (scheduledSpending.get(catId) ?? 0n) + value);
        spendingLines.push({
          category_id: catId,
          source: later ? "scheduled" : "auto",
          description: p.description,
          account_name:
            accounts.find((a) => a.id === p.local_account_id)?.name ?? "",
          transaction_date: p.transaction_date,
          amount_cents: value.toString(),
        });
      } else {
        income += cents; // entrada
      }
    }
    // Entradas previstas que ainda não chegaram (salário, aluguel recebido...),
    // pela DATA esperada de chegada (não pelo mês de planejamento: um salário
    // do dia 23 planejado para o mês seguinte chega neste mês na conta).
    // item de entrada vivo do mês, em aberto. Sai do "previsto" quando foi
    // conferido (evento ligado), pago à mão, ou quando o crédito do banco já
    // foi achado (ocorrência detected, ou review com crédito do banco ligado).
    const incomeExpected = (
      await tx.query<{ label: string; due_date: string | null; cents: string }>(
        `SELECT i.label, COALESCE(o.expected_date, i.due_date)::text AS due_date,
                GREATEST(i.planned_cents - COALESCE(i.paid_cents, 0), 0)::text AS cents
           FROM monthly_items i
           LEFT JOIN recurrence_occurrences o ON o.household_id=i.household_id AND o.monthly_item_id=i.id
          WHERE i.household_id=$1 AND i.currency=$3 AND i.purpose='income'
            AND (CASE WHEN o.expected_date IS NOT NULL
                      THEN o.expected_date>=$2::date AND o.expected_date<($2::date + interval '1 month')
                      ELSE i.month=$2 END)
            AND NOT i.archived AND NOT i.derived AND i.planned_cents IS NOT NULL
            AND (i.event_id IS NULL OR i.status='partial') AND i.status<>'done'
            AND COALESCE(o.match_state, 'planned')<>'detected'
            AND NOT (COALESCE(o.match_state, 'planned')='review' AND o.match_bank_transaction_id IS NOT NULL)
          ORDER BY COALESCE(o.expected_date, i.due_date), i.label`,
        [user.familyId, month, currency],
      )
    ).rows.filter((r) => BigInt(r.cents) > 0n);
    const { budgets, outflow } = await readCommitments(
      tx,
      user.familyId,
      month,
      currency,
      spending,
      bankCover,
      scheduledSpending,
    );
    const batches = (
      await tx.query<BatchView>(
        "SELECT b.id,b.account_id,b.status,b.parser,b.created_at,b.context,f.filename,(SELECT count(*)::integer FROM staged_transactions s WHERE s.batch_id=b.id) AS row_count,(SELECT count(*)::integer FROM staged_transactions s WHERE s.batch_id=b.id AND (NOT s.reviewed OR s.decision='pending')) AS pending_count FROM import_batches b JOIN source_files f ON f.id=b.source_id WHERE b.household_id=$1 ORDER BY b.created_at DESC",
        [user.familyId],
      )
    ).rows;
    const duplicate = (
      await tx.query<{ count: number }>(
        "SELECT count(*)::integer AS count FROM staged_transactions s JOIN import_batches b ON b.id=s.batch_id WHERE s.household_id=$1 AND s.duplicate_hint AND b.status='preview'",
        [user.familyId],
      )
    ).rows[0].count;
    const audit = (
      await tx.query(
        "SELECT action,entity_id,metadata,created_at FROM audit_events WHERE household_id=$1 ORDER BY created_at DESC LIMIT 50",
        [user.familyId],
      )
    ).rows;
    const pendingAnalysis = analyzePending(
      withEvidence ? await pendingRows(tx, user.familyId) : [],
      user.name,
    );
    const insights: {
      type: string;
      title: string;
      fact: string;
      action: string;
      period: string;
    }[] = [];
    const pending = batches
      .filter((b) => b.status === "preview")
      .reduce((sum, b) => sum + Number(b.pending_count), 0);
    if (planning.some((p) => p.derived))
      insights.push({
        type: "budget",
        title: "Orçamento derivado da sua planilha",
        fact: "O planejamento deste mês usa os valores da coluna real como base, conforme sua instrução. As referências manuais não geram transações adicionais.",
        action:
          "Compare com os lançamentos bancários e ajuste o plano conforme seus compromissos atuais.",
        period: month.slice(0, 7),
      });
    if (planning.some((p) => p.error))
      insights.push({
        type: "budget",
        title: "Fórmulas de orçamento precisam de correção",
        fact: "Há itens com referência quebrada ou valor não numérico. A categoria afetada não recebe um total parcial apresentado como orçamento completo.",
        action:
          "Abra a origem na tela Orçamento e informe o planejamento correto da categoria.",
        period: month.slice(0, 7),
      });
    if (planning.some((p) => p.purpose === "benefit" || /caju/i.test(p.notes)))
      insights.push({
        type: "budget",
        title: "Gastos por benefício têm cobertura parcial",
        fact: "A planilha identifica pagamentos pelo Caju, mas não foi fornecido um extrato desse benefício. O realizado bancário pode ser menor que o consumo da família.",
        action:
          "Consulte a referência manual separada e forneça o extrato do benefício antes de concluir que houve economia.",
        period: month.slice(0, 7),
      });
    const largest = [...spending.entries()]
      .filter(([k, v]) => v > 0n && k !== UNCATEGORIZED)
      .sort((a, b) => (a[1] > b[1] ? -1 : 1))[0];
    if (largest) {
      const cat = categories.find((c) => c.id === largest[0]);
      insights.push({
        type: "spending",
        title: `Maior despesa registrada: ${cat?.name ?? "categoria"}`,
        fact: "Esta categoria concentra o maior valor de despesas líquidas confirmadas no filtro atual. A cobertura ainda pode ser parcial.",
        action:
          "Confira as transações e compare com o orçamento antes de mudar os limites.",
        period: month.slice(0, 7),
      });
    }
    const usdIncome =
      (
        await tx.query(
          "SELECT 1 FROM economic_events WHERE household_id=$1 AND currency='USD' AND kind='income' AND transaction_date>=$2::date AND transaction_date<($2::date+interval '1 month') LIMIT 1",
          [user.familyId, month],
        )
      ).rows.length > 0;
    if (usdIncome)
      insights.push({
        type: "income_currency",
        title: "Recebimentos em dólar preservados",
        fact: "Os recebimentos profissionais em USD estão separados das conversões para BRL e EUR. Converter seu próprio saldo não cria nova receita.",
        action:
          "Selecione USD para consultar as receitas em dólar. Compare a viagem com os gastos em EUR, sem somar moedas diretamente.",
        period: month.slice(0, 7),
      });
    if (batches.some((b) => b.context?.reconciliation?.status === "difference"))
      insights.push({
        type: "reconciliation",
        title: "Diferença entre o banco e os registros locais",
        fact: "Existe um saldo observado no extrato que não coincide com a abertura e os movimentos registrados na conta.",
        action:
          "Abra a importação e confira a diferença. Revise abertura, lacunas e itens ignorados; nenhum ajuste foi criado automaticamente.",
        period: "Saldos de referência dos extratos confirmados",
      });
    if (pending)
      insights.push({
        type: "review",
        title: "Revisão antes dos indicadores",
        fact: `${pending} itens de importação aguardam decisão e ainda não afetam os resultados.`,
        action:
          "Abra as prévias, confira finalidade, categoria e possíveis transferências.",
        period: "Todas as prévias locais",
      });
    if (duplicate)
      insights.push({
        type: "duplicate",
        title: "Possíveis duplicidades",
        fact: `${duplicate} itens têm evidências semelhantes a outros registros. Isso não comprova duplicidade.`,
        action: "Compare as origens e justifique manter, vincular ou ignorar.",
        period: "Todas as prévias locais",
      });
    const missing = accounts.filter((a) => a.opening_cents === null).length;
    if (pendingAnalysis.counts.fx)
      insights.push({
        type: "pending_fx",
        title: "Câmbio e tarifas precisam de revisão conjunta",
        fact: `${pendingAnalysis.counts.fx} conversões identificadas nas prévias, com ${pendingAnalysis.counts.fees} tarifas Wise separadas. O principal convertido não é receita ou despesa; tarifas são custos separados.`,
        action:
          "Abra as pendências, confira principal líquido, tarifa e a segunda evidência antes de confirmar.",
        period: "Todas as prévias · não confirmado",
      });
    if (pendingAnalysis.counts.transfers)
      insights.push({
        type: "pending_transfer",
        title: "Transferências podem inflar renda e gastos",
        fact: `${pendingAnalysis.counts.transfers} pares de valores opostos citam seu nome em contas diferentes.`,
        action:
          "Confirme titularidade; trate cada par comprovado como uma operação única.",
        period: "Todas as prévias · não confirmado",
      });
    if (pendingAnalysis.counts.cards)
      insights.push({
        type: "pending_card",
        title: "Fatura não deve repetir as compras",
        fact: `${pendingAnalysis.counts.cards} pagamentos de fatura aguardam identificação do cartão e titular.`,
        action:
          "Escolha o cartão de contrapartida e confira se o consumo da fatura está coberto.",
        period: "Todas as prévias · não confirmado",
      });
    if (pendingAnalysis.counts.remittances)
      insights.push({
        type: "pending_remittance",
        title: "Remessa internacional ainda sem comprovante",
        fact: `${pendingAnalysis.counts.remittances} caso(s) de possível remessa ligam moedas diferentes sem ID compartilhado.`,
        action:
          "Confira o comprovante, o destino e os valores. Não presuma renda ou uma cotação.",
        period: "Todas as prévias · não confirmado",
      });
    // Coverage comes from declared statement intervals, never from filename dates.
    for (const account of accounts) {
      const periods = (
        await tx.query<{ start: string; end: string }>(
          "SELECT period_start::text AS start,period_end::text AS end FROM import_batches WHERE household_id=$1 AND account_id=$2 AND period_start IS NOT NULL AND period_end IS NOT NULL ORDER BY period_start",
          [user.familyId, account.id],
        )
      ).rows;
      const gaps: string[] = [];
      for (let i = 1; i < periods.length; i++) {
        const previousEnd = periods
          .slice(0, i)
          .map((p) => p.end)
          .sort()
          .at(-1)!;
        if (Date.parse(periods[i].start) - Date.parse(previousEnd) > 86400000)
          gaps.push(`${previousEnd} até ${periods[i].start}`);
      }
      if (gaps.length)
        insights.push({
          type: "pending_coverage",
          title: `Lacuna de extratos: ${account.name}`,
          fact: `Intervalos sem cobertura entre ${gaps.join("; ")}. As datas indicam os limites dos extratos adjacentes.`,
          action:
            "Forneça o período ausente antes de interpretar tendências ou concluir que não houve movimento.",
          period: "Cobertura dos arquivos locais",
        });
    }
    if (missing)
      insights.push({
        type: "opening",
        title: "Saldos ainda parciais",
        fact: `${missing} contas não têm abertura confirmada. A movimentação não representa o saldo total.`,
        action: "Informe o saldo de referência anterior ao primeiro movimento.",
        period: "Posição atual das contas",
      });
    for (const b of budgets.filter((b) => b.over))
      insights.push({
        type: "budget",
        title: `Orçamento excedido: ${b.category_name}`,
        fact:
          BigInt(b.remaining_cents) < 0n
            ? "As despesas líquidas confirmadas superam o planejamento configurado para a categoria."
            : "As despesas confirmadas somadas ao que ainda está previsto em aberto superam o teto configurado para a categoria.",
        action:
          "Abra as transações da categoria e revise as prioridades do mês.",
        period: month.slice(0, 7),
      });
    for (const cycleMonth of [...cardCompetenceConflict].sort())
      insights.push({
        type: "card",
        title: "Mês da fatura do cartão em dúvida",
        fact: `A fatura de ${cycleMonth} foi identificada pelo banco, mas o ciclo cadastrado apontaria outro mês. Confira o ciclo do cartão.`,
        action:
          "Abra o cartão em Perfil, Bancos e confira o fechamento e o vencimento cadastrados.",
        period: monthKey,
      });
    // Gasto no cartão em moeda diferente da tela, na mesma janela que
    // readCardEvents varre. Sem taxa de câmbio não se soma valor convertido:
    // só avisamos que existe gasto estrangeiro fora deste total em reais.
    const otherCurrencyCardSpend = await readOtherCurrencyCardSpend(tx, {
      familyId: user.familyId,
      month,
      currency,
      accountId,
      categoryId,
    });
    if (otherCurrencyCardSpend.length)
      insights.push({
        type: "card",
        title: "Gastos de cartão em outra moeda fora do total",
        fact: `Há gastos no cartão em outra moeda (${otherCurrencyCardSpend
          .map((s) => s.currency)
          .join(", ")}) que não entram neste total em reais. Registre o valor equivalente para incluir.`,
        action:
          "Registre a conversão para reais de cada gasto estrangeiro do cartão para que ele entre no total.",
        period: monthKey,
      });
    const cards = events.filter((e) => e.kind === "card_payment");
    if (cards.length)
      insights.push({
        type: "card",
        title: "Faturas e consumo têm papéis diferentes",
        fact: `${cards.length} pagamentos de fatura estão classificados como liquidação de obrigação.`,
        action:
          "Confira se as compras de crédito e a obrigação inicial também foram registradas; sem isso, o consumo pode estar incompleto.",
        period: month.slice(0, 7),
      });
    const movements = events.filter((e) =>
      ["transfer", "investment_buy", "investment_sell", "fx"].includes(e.kind),
    );
    if (movements.some((e) => e.sources.length < 2))
      insights.push({
        type: "counterpart",
        title: "Contrapartidas a comprovar",
        fact: "Existem movimentações próprias cuja segunda perna foi criada pela revisão e ainda não tem outra origem vinculada.",
        action:
          "Ao importar o outro extrato, vincule a evidência ao evento existente em vez de criar outro movimento.",
        period: month.slice(0, 7),
      });
    // Pendências vindas do banco conectado (bank_transactions), distintas das de
    // import de arquivo (bankRows). Só as do mês/moeda da tela e ainda não
    // registradas. `blocked` marca as que o fluxo não deixa registrar agora
    // (provisórias no banco, alteradas ou sumidas); a aba Movimentos usa isso
    // para esconder o botão de aprovar. Totais nunca mudam por estas linhas.
    const bankPending = (
      await tx.query<{
        id: string;
        version: number;
        local_account_id: string;
        transaction_date: string;
        description: string;
        amount_cents: string;
        account_name: string;
        account_kind: string;
        tag_id: string | null;
        tag_name: string | null;
        tag_category_name: string | null;
        alias_name: string | null;
        group: string | null;
        duplicate: boolean;
        blocked: boolean;
        autospend: boolean;
        scheduled: boolean;
      }>(
        `SELECT t.id,t.version,t.local_account_id,t.transaction_date::text,t.description,t.amount_cents::text,a.name AS account_name,a.kind AS account_kind,t.tag_id,tg.name AS tag_name,tgc.name AS tag_category_name,ma.alias AS alias_name,t.analysis->>'group' AS "group",coalesce(t.analysis->>'group','')='duplicate' AS duplicate,(NOT ${settledSql("t")} OR t.changed OR t.missing) AS blocked,(a.kind<>'card' AND t.event_id IS NULL AND NOT t.missing AND NOT t.changed AND t.amount_cents<0 AND ${AUTO_OUTFLOW_SQL} AND coalesce(t.analysis->>'group','') NOT IN ('duplicate','history','card','transfer','investment')) AS autospend,(${scheduledSql("t")} AND a.kind<>'card' AND t.event_id IS NULL AND NOT t.missing AND NOT t.changed AND t.amount_cents<0 AND ${AUTO_OUTFLOW_SQL} AND coalesce(t.analysis->>'group','') NOT IN ('duplicate','history','card','transfer','investment')) AS scheduled FROM bank_transactions t JOIN accounts a ON a.id=t.local_account_id LEFT JOIN category_tags tg ON tg.id=t.tag_id AND tg.household_id=t.household_id LEFT JOIN categories tgc ON tgc.id=tg.category_id AND tgc.household_id=tg.household_id LEFT JOIN merchant_aliases ma ON ma.household_id=t.household_id AND ma.key=merchant_key(t.description) WHERE t.household_id=$1 AND t.status='pending' AND NOT t.missing AND t.currency=$2 AND t.transaction_date>=$3::date AND t.transaction_date<($3::date+interval '1 month') AND ($4::uuid IS NULL OR t.local_account_id=$4) ORDER BY t.transaction_date DESC,t.id`,
        [user.familyId, currency, month, accountId ?? null],
      )
    ).rows.map((r) => {
      // Sugestão de aprendizado (caminho 1): chave derivada da descrição e
      // categoria resolvida (regra aprendida -> regex -> fallback). A UI mostra
      // o formulário para confirmar/editar antes de gravar a merchant_rule;
      // quando a categoria já veio de uma regra (learned), esconde o formulário.
      const resolved = resolveCategory(merchantRules, r.description);
      const { tag_category_name, ...row } = r;
      const tagMatches = tag_category_name === resolved.name;
      return {
        ...row,
        tag_id: tagMatches ? r.tag_id : null,
        tag_name: tagMatches ? r.tag_name : null,
        suggested_key: merchantKey(r.description),
        suggested_category: resolved.name,
        // strong=true => já tem categoria real (regra ou regex forte); a UI
        // esconde os campos de categorizar. strong=false => caiu no fallback
        // "Outras despesas", ainda sem categoria -> mostra os campos.
        category_strong: resolved.strong,
      };
    });
    // Gasto por categoria pela COMPETÊNCIA (mesma fonte do total do mês em
    // summary.expense_cents): o Map `spending` já pesa cartão pelo vencimento
    // da fatura. A tela de orçamento consome isto em vez de somar por data em
    // state.events, para não divergir do total do mês. Só categorias com
    // despesa líquida positiva, ordenadas desc; "uncategorized" vira "Sem
    // categoria". Valores em string de centavos, como o resto do estado.
    const competenceSpending = {
      slices: [...spending.entries()]
        .filter(([, cents]) => cents > 0n)
        .sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0))
        .map(([id, cents]) => ({
          id,
          name:
            id === "uncategorized"
              ? "Sem categoria"
              : (categories.find((c) => c.id === id)?.name ?? "Sem categoria"),
          cents: cents.toString(),
        })),
      total_cents: [...spending.values()]
        .filter((cents) => cents > 0n)
        .reduce((sum, cents) => sum + cents, 0n)
        .toString(),
    };
    return {
      user,
      month,
      currency,
      accounts,
      categories,
      events: events.map((e) => ({ ...e, name: eventName(e), fixed: fixedIds.has(e.id) })),
      competenceSpending,
      spendingLines,
      budgets,
      outflow,
      batches,
      audit,
      insights,
      pending: pendingAnalysis,
      planning,
      bankRows,
      bankPending,
      cardBudgetUnconfigured: [...cardBudgetUnconfigured],
      cardDueOtherMonth: {
        cents: cardDueOtherMonthCents.toString(),
        count: cardDueOtherMonthItems.length,
        items: cardDueOtherMonthItems,
      },
      importTotals,
      summary: {
        income_cents: income.toString(),
        income_expected_cents: incomeExpected.reduce((s, r) => s + BigInt(r.cents), 0n).toString(),
        income_expected: incomeExpected,
        expense_cents: expense.toString(),
        expense_left_cents: expenseLeft.toString(),
        expense_scheduled_cents: expenseScheduled.toString(),
        expense_card_cents: expenseCard.toString(),
        result_cents: (income - expense).toString(),
        savings_basis_points: savings(income, expense),
        event_count: events.length,
      },
      coverage:
        "Resultados refletem somente eventos confirmados no filtro. Não comprovam cobertura completa das contas ou do mês.",
    };
  });
}
