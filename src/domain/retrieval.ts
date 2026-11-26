import type { HelpContext } from "./help.ts";
import type { Currency } from "./finance.ts";
import { formatted } from "./format.ts";

// O modelo erra a unidade ao ler centavos (R$ 8.314,70 virava "R$831.470").
// Cada campo `*_cents` ganha um irmão `*_formatted` já pronto, calculado aqui.
export function withFormattedMoney(
  value: unknown,
  currency: Currency,
): unknown {
  if (Array.isArray(value))
    return value.map((v) => withFormattedMoney(v, currency));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, v]) => {
      const entries: [string, unknown][] = [
        [key, withFormattedMoney(v, currency)],
      ];
      const moneyKey = key === "cents" || key.endsWith("_cents");
      if (moneyKey && typeof v === "string" && /^-?\d+$/.test(v))
        entries.push([
          key === "cents" ? "formatted" : key.slice(0, -6) + "_formatted",
          formatted(v, currency),
        ]);
      return entries;
    }),
  );
}

const normalizeQuestion = (question: string) =>
  question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Uma categoria é citada quando alguma palavra da pergunta (4+ letras) aparece
// no nome dela, sem acento. Mesma regra do T1 e do detalhe por item do G1.
export function categoryMentioned(question: string, name: string) {
  const terms = normalizeQuestion(question)
    .split(/\W+/)
    .filter((t) => t.length >= 4);
  const n = normalizeQuestion(name);
  return terms.some((t) => n.includes(t));
}

export function classifyQuestion(question: string) {
  const q = normalizeQuestion(question);
  const food = /alimenta|mercado|comida|feira/.test(q);
  const investment = /invest|reserv|aplic|resgat|rendiment/.test(q);
  const bills = /conta|pagar|venc|penden|atras/.test(q);
  const history = /gast|consumo|receb|entrou|entrada|historico/.test(q);
  const plan =
    /plano|planej|sobra|guardar|disponivel/.test(q) ||
    (!food && !investment && !bills && !history);
  const insights =
    /tendenc|\bmedia\b|poupan|evolu|categoria|lugar|onde gast/.test(q);
  const goals = /objetiv|\bmetas?\b|guardar para|prazo|reserv/.test(q);
  const future =
    /preciso guardar|quanto guardar|ate quando|simul|e se |cortar|pausar|imprevisto/.test(
      q,
    );
  const categories = food || history || insights;
  return {
    food,
    investment,
    bills,
    history,
    plan,
    insights,
    goals,
    future,
    categories,
  };
}

// Structured RAG: retrieve bounded facts from the authorized database snapshot.
// No generated SQL, document upload, vector service or model-computed money.
export function retrieveFacts(question: string, c: HelpContext) {
  const q = normalizeQuestion(question);
  const cq = classifyQuestion(question);
  const items = c.items.filter((i) => i.currency === c.currency);
  const sum = (rows: typeof items) =>
    rows.reduce((s, i) => s + BigInt(i.planned_cents ?? "0"), 0n);
  const facts: { id: string; label: string; data: Record<string, unknown> }[] =
    [];
  if (c.historyMonths) {
    facts.push({
      id: "T1",
      label: "Histórico da família em todos os meses disponíveis",
      data: {
        monthly_totals: c.historyMonths.map(({ categories, ...month }) => ({
          ...month,
          // O mês que G1 detalha sai daqui: são duas contas diferentes da
          // mesma categoria, e mostrar as duas lado a lado confunde.
          relevant_categories:
            cq.categories &&
            c.categorySpend &&
            month.month === c.categorySpend.month
              ? []
              : categories.filter((category) =>
                  categoryMentioned(question, category.name),
                ),
        })),
        confirmed_only: true,
        card_purchases_count_in_their_invoice_month: true,
        own_transfers_fx_principal_and_invoice_payments_excluded: true,
        missing_month_is_not_zero: true,
        not_a_bank_balance: true,
        // Outra população que a do Panorama e das ferramentas de sobra
        // (essas incluem pendentes do banco e contam cartão na data da compra).
        not_comparable_with_panorama_or_sobra_tools: true,
      },
    });
  }
  if (c.bankReviewCount !== undefined && /banc|cruzamento|duplic|revis/.test(q))
    facts.push({
      id: "B1",
      label: "Revisão bancária",
      data: {
        pending_bank_observations: c.bankReviewCount ?? 0,
        not_in_confirmed_totals: true,
      },
    });
  const { food, investment, bills, history, plan } = cq;
  if (
    /salario|wise|wize|financia|entrada|receb/.test(q) &&
    items.some((i) => i.funding)
  ) {
    facts.push({
      id: "R1",
      label: "Recebimentos que financiam o mês",
      data: {
        expected_receipts: items
          .filter((i) => i.funding)
          .map((i) => ({
            expected_date: i.funding!.expected_date,
            bank_received_date: i.funding!.received_date,
            review_state: i.funding!.state,
            budget_month: c.month,
            not_confirmed_income: true,
          })),
        no_raw_bank_descriptions: true,
      },
    });
  }
  if (plan) {
    const incoming = sum(items.filter((i) => i.purpose === "income")),
      outgoing = sum(items.filter((i) => i.purpose !== "income"));
    facts.push({
      id: "P1",
      label: "Planejamento mensal",
      data: {
        planned_income_cents: incoming.toString(),
        planned_commitments_cents: outgoing.toString(),
        planned_difference_cents: (incoming - outgoing).toString(),
        unknown_planned_values: items.some((i) => i.planned_cents === null),
        not_a_bank_balance: true,
      },
    });
  }
  if (bills) {
    const open = items.filter(
      (i) => i.purpose !== "income" && i.status !== "done",
    );
    facts.push({
      id: "C1",
      label: "Itens do planejamento em aberto (sem faturas de cartão nem agendados)",
      data: {
        count: open.length,
        known_remaining_cents: open
          .reduce((s, i) => {
            const n =
              BigInt(i.planned_cents ?? "0") - BigInt(i.paid_cents ?? "0");
            return s + (n > 0n ? n : 0n);
          }, 0n)
          .toString(),
        unknown_amounts: open.filter((i) => i.planned_cents === null).length,
        without_due_date: open.filter((i) => !i.due_date).length,
        due_until_today_count: open.filter(
          (i) => i.due_date && i.due_date <= c.today,
        ).length,
        as_of_date: c.today,
        individual_details_omitted: true,
        // Itens do plano: faturas de cartão e agendados do banco ficam fora.
        not_complete_bills_list_use_tool: "falta_pagar",
      },
    });
  }
  if (food) {
    const rows = c.budgets.filter((b) =>
      /alimenta|supermerc|feira/.test(
        b.category_name
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase(),
      ),
    );
    const total = (key: "planned_cents" | "spent_cents" | "remaining_cents") =>
      rows.reduce((s, r) => s + BigInt(r[key]), 0n).toString();
    facts.push({
      id: "A1",
      label: "Orçamento de alimentação",
      data: {
        available: rows.length > 0,
        planned_cents: total("planned_cents"),
        confirmed_spent_cents: total("spent_cents"),
        remaining_cents: total("remaining_cents"),
        partial_history: true,
      },
    });
  }
  if (investment)
    facts.push({
      id: "I1",
      label: "Movimentações de investimentos",
      data: {
        movements: (c.investmentMovements ?? [])
          .filter((r) => r.currency === c.currency)
          .map(({ kind, amount_cents }) => ({ kind, amount_cents })),
        not_current_portfolio_value: true,
        yields_may_include_checking_accounts: true,
      },
    });
  if (history || (!food && !investment && !bills))
    facts.push({
      id: "H1",
      label: "Movimentos do mês",
      data: {
        income_cents: c.income_cents,
        consumption_cents: c.expense_cents,
        card_purchases_count_in_their_invoice_month: true,
        own_transfers_and_fx_principal_excluded: true,
      },
    });
  if (cq.insights && c.insights) {
    const pending = { includes_pending_bank_movements: true };
    facts.push(
      {
        id: "E1",
        label: "Evolução de gastos",
        data: { summary: c.insights.summary, ...pending },
      },
      {
        id: "D1",
        label: "Categorias de despesas",
        data: {
          this_month: c.insights.categories_month,
          last_month: c.insights.categories_last_month,
          ...pending,
        },
      },
      {
        id: "L1",
        label: "Lugares frequentes",
        data: { places_last_12_months: c.insights.places_year, ...pending },
      },
    );
  }
  if (cq.categories && c.categorySpend)
    facts.push({
      id: "G1",
      label: "Gastos do mês por categoria",
      data: {
        ...c.categorySpend,
        same_numbers_as_the_panorama_screen: true,
        all_categories_listed: true,
        category_not_listed_means_no_spend_in_the_month: true,
        includes_pending_bank_movements: true,
      },
    });
  if (cq.goals && c.goalList)
    facts.push({
      id: "M1",
      label: "Reservas cadastradas no app (dinheiro guardado para um fim, com alvo)",
      data: {
        goals: c.goalList,
        // Não confundir: metas e limites combinados em conversa estão na
        // memória do assistente (search_memory), não aqui.
        not_conversation_goals_or_limits: true,
        // "Quanto combinamos guardar este mês" numa reserva é o plano do mês
        // (planned_this_month_cents), não uma memória de conversa.
        planned_this_month_is_the_monthly_agreement: true,
        missing_per_goal_in_tool: "reservas",
        saved_equals_verified_plus_declared: true,
        not_investment_balance: true,
      },
    });
  if ((cq.future || cq.goals) && c.futureGoalNeeds)
    facts.push({
      id: "F1",
      label: "Necessidade mensal por reserva cadastrada",
      data: {
        goals: c.futureGoalNeeds,
        future_is_a_projection_not_a_promise: true,
      },
    });
  return {
    period: c.month,
    currency: c.currency,
    unit: "integer cents",
    unresolved_movements: c.unresolved,
    coverage:
      "Confirmed events and planning in the authorized family history, with monthly details for the question's reference period. Not proof of complete history. Missing months and unknown amounts are not zero-valued evidence. No real-time balances or market prices.",
    facts: withFormattedMoney(facts, c.currency) as typeof facts,
  };
}
