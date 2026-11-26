// Motor determinístico do Copiloto (protótipo). Sem IA, sem aleatoriedade:
// toda data, valor e mensagem sai destas funções e pode ser conferida à mão.
// Valores em reais inteiros (o app real usa centavos BigInt; aqui basta).

export const PROJECTION_MONTHS = 36;
/** Mês 0 da projeção = dezembro de 2026 (próxima entrada). */
const START_YEAR = 2026;
const START_MONTH = 11; // 0-based: dezembro

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MES_LONGO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

export function monthParts(i: number) {
  const t = START_MONTH + i;
  return { y: START_YEAR + Math.floor(t / 12), m: ((t % 12) + 12) % 12 };
}
export const monthShort = (i: number) => {
  const { y, m } = monthParts(i);
  return `${MES[m]}/${String(y).slice(2)}`;
};
export const monthName = (i: number) => MES[monthParts(i).m];
export const monthLong = (i: number) => {
  const { y, m } = monthParts(i);
  return `${MES_LONGO[m]} de ${y}`;
};
export const yearOf = (i: number) => monthParts(i).y;

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});
/** "R$ 4.100" · negativos com sinal de menos tipográfico. */
export function fmt(v: number): string {
  const r = Math.round(v);
  const s = BRL.format(Math.abs(r)).replace(/ /g, " ");
  return r < 0 ? "−" + s : s;
}
export function fmtSigned(v: number): string {
  const r = Math.round(v);
  if (r === 0) return fmt(0);
  return (r > 0 ? "+" : "") + fmt(r);
}
export const fmtNum = (v: number, d = 1) =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------------------------------------------------------------- tipos

export type DebtKind = "parcelado" | "emprestimo" | "cartao" | "informal";
export const DEBT_KIND_LABEL: Record<DebtKind, string> = {
  parcelado: "Parcelamento",
  emprestimo: "Empréstimo",
  cartao: "Cartão / rotativo",
  informal: "Acordo informal",
};

export type Debt = {
  id: string;
  name: string;
  balance: number;
  /** Pagamento mensal planejado. */
  payment: number;
  /** Pagamento adicional simulado/planejado por mês. */
  extra: number;
  /** % ao mês; null = não informado (premissa: 0%). */
  rate: number | null;
  dueDay: number;
  kind: DebtKind;
  /** 1 = primeira a receber valor liberado. */
  priority: number;
};

export type GoalKind = "reserva" | "data" | "aberto";
export type Goal = {
  id: string;
  name: string;
  kind: GoalKind;
  saved: number;
  /** null = objetivo aberto, sem valor-alvo. */
  target: number | null;
  contribution: number;
  /** Mês (índice) desejado; só para kind "data". */
  due: number | null;
  priority: number;
  /** Ajuste temporário de aporte (amount 0 = pausa). */
  adjust: { from: number; months: number; amount: number } | null;
};

export type Shock = {
  id: string;
  kind: "despesa" | "receita";
  from: number;
  months: number;
  /** Valor por mês (despesa: saída extra; receita: redução da entrada). */
  amount: number;
  label: string;
};

export type Lump = { debtId: string; month: number; amount: number };

export type CardInstallment = {
  id: string;
  label: string;
  /** Valor de cada parcela. */
  amount: number;
  total: number;
  /** Parcelas já pagas antes da fatura de `start`. */
  paid: number;
  /** Mês (índice) da fatura da próxima parcela. */
  start: number;
  /** Compra simulada (não existe no cartão real). */
  simulated?: boolean;
};

export type Card = {
  name: string;
  dueDay: number;
  recurring: { label: string; amount: number }[];
  /** Média do gasto variável das últimas faturas: estimativa, não compromisso. */
  variableAvg: number;
  installments: CardInstallment[];
  /** Gastos pontuais já previstos para uma fatura. */
  extras: { month: number; amount: number; label: string }[];
};

export type Plan = {
  income: number;
  essentials: number;
  /** Contas fixas fora do cartão. */
  commitments: number;
  startBalance: number;
  card: Card;
  debts: Debt[];
  goals: Goal[];
  shocks: Shock[];
  lumps: Lump[];
  /** Valor liberado por dívida quitada segue para a próxima prioridade. */
  snowball: boolean;
};

// ---------------------------------------------------------------- cenário

export const INITIAL_PLAN: Plan = {
  income: 6000,
  essentials: 2400,
  commitments: 700,
  startBalance: 4100,
  card: {
    name: "Cartão principal",
    dueDay: 10,
    recurring: [
      { label: "Assinaturas e apps", amount: 120 },
      { label: "Academia", amount: 110 },
    ],
    variableAvg: 650,
    installments: [
      { id: "geladeira", label: "Geladeira", amount: 260, total: 10, paid: 3, start: 0 },
      { id: "oculos", label: "Óculos", amount: 160, total: 6, paid: 3, start: 0 },
    ],
    extras: [{ month: 1, amount: 550, label: "Compras de fim de ano" }],
  },
  debts: [
    { id: "a", name: "Dívida A", balance: 6000, payment: 500, extra: 0, rate: null, dueDay: 10, kind: "emprestimo", priority: 2 },
    { id: "b", name: "Dívida B", balance: 2400, payment: 200, extra: 0, rate: null, dueDay: 20, kind: "parcelado", priority: 1 },
  ],
  goals: [
    { id: "reserva", name: "Reserva de emergência", kind: "reserva", saved: 2300, target: 10000, contribution: 500, due: null, priority: 1, adjust: null },
    { id: "viagem", name: "Viagem", kind: "data", saved: 900, target: 4000, contribution: 0, due: 12, priority: 2, adjust: null },
  ],
  shocks: [],
  lumps: [],
  snowball: false,
};

export const PREMISES = [
  "Juros desconhecidos são tratados como 0% ao mês. Informe a taxa para um cálculo real.",
  "A folga livre de cada mês é considerada gasta no próprio mês. O saldo em conta só muda quando falta folga.",
  "A reserva não cobre déficits automaticamente: não é dinheiro para gasto corrente.",
  "Entrada de R$ 6.000, essenciais de R$ 2.400 e R$ 700 de contas fixas se repetem todo mês.",
  "Fatura do cartão = recorrentes + parcelas restantes + média do gasto do dia a dia (R$ 650, estimativa). Quando uma parcela termina, a fatura cai e a folga sobe.",
  "Patrimônio no escopo do app: conta + reservas − dívidas cadastradas. Bens e investimentos não cadastrados ficam de fora.",
];

export type BillPart = { id: string; label: string; amount: number; kind: "recorrente" | "variavel" | "parcela" | "extra"; n?: number; total?: number; simulated?: boolean };
export type Bill = { total: number; parts: BillPart[] };

/** Fatura projetada do cartão no mês i, item a item. */
export function cardBill(card: Card, i: number): Bill {
  const parts: BillPart[] = [];
  for (const r of card.recurring) parts.push({ id: "rec-" + r.label, label: r.label, amount: r.amount, kind: "recorrente" });
  parts.push({ id: "var", label: "Gasto do dia a dia (média)", amount: card.variableAvg, kind: "variavel" });
  for (const p of card.installments) {
    const left = p.total - p.paid;
    if (i >= p.start && i < p.start + left)
      parts.push({ id: "parc-" + p.id, label: p.label, amount: p.amount, kind: "parcela", n: p.paid + 1 + (i - p.start), total: p.total, simulated: p.simulated });
  }
  for (const e of card.extras.filter((e) => e.month === i)) parts.push({ id: "ext-" + e.label + i, label: e.label, amount: e.amount, kind: "extra" });
  return { total: parts.reduce((a, x) => a + x.amount, 0), parts };
}

/** Último mês com parcela de cada compra. */
export const installmentEnd = (p: CardInstallment) => p.start + (p.total - p.paid) - 1;

/** Verba do plano num mês: entrada − essenciais − contas fixas − fatura. */
export const monthBudget = (p: Plan, i: number) => p.income - p.essentials - p.commitments - cardBill(p.card, i).total;
/** Verba do próximo mês (mês 0). */
export const baseBudget = (p: Plan) => monthBudget(p, 0);

// ---------------------------------------------------------------- projeção

export type Row = {
  i: number;
  /** Entrada − essenciais − contas fixas (antes do cartão). */
  preCard: number;
  /** Fatura do cartão projetada. */
  card: number;
  budget: number;
  shockOut: number;
  available: number;
  debtPay: Record<string, number>;
  debtInterest: Record<string, number>;
  debtBal: Record<string, number>;
  lump: number;
  goalIn: Record<string, number>;
  goalBal: Record<string, number>;
  toDebts: number;
  toGoals: number;
  free: number;
  bank: number;
  reserves: number;
  debtTotal: number;
  netWorth: number;
};

export type MilestoneKind = "debt-paid" | "debts-free" | "goal-reached" | "cover-1" | "cover-3" | "goal-due";
export type Milestone = {
  id: string;
  kind: MilestoneKind;
  month: number;
  refId: string;
  title: string;
  short: string;
  why: string[];
  /** goal-due sem atingir o alvo. */
  missed?: boolean;
};

export type Conflict = { i: number; amount: number; cause: string };

export type Projection = {
  rows: Row[];
  milestones: Milestone[];
  payoff: Record<string, number | null>;
  reach: Record<string, number | null>;
  totals: Record<string, { paid: number; interest: number }>;
  conflicts: Conflict[];
  regularOver: number;
  minBank: { i: number; v: number };
  neverPays: string[];
};

const EPS = 0.5;
const sortByPriority = <T extends { priority: number }>(xs: T[]) =>
  [...xs].sort((a, b) => a.priority - b.priority);

function goalContribution(g: Goal, i: number) {
  if (g.adjust && i >= g.adjust.from && i < g.adjust.from + g.adjust.months) return g.adjust.amount;
  return g.contribution;
}

export function project(plan: Plan, months = PROJECTION_MONTHS): Projection {
  const debtBal: Record<string, number> = {};
  const goalBal: Record<string, number> = {};
  const payoff: Record<string, number | null> = {};
  const reach: Record<string, number | null> = {};
  const totals: Record<string, { paid: number; interest: number }> = {};
  const paidAt: Record<string, number> = {};
  for (const d of plan.debts) {
    debtBal[d.id] = d.balance;
    payoff[d.id] = d.balance <= EPS ? -1 : null;
    totals[d.id] = { paid: 0, interest: 0 };
  }
  for (const g of plan.goals) {
    goalBal[g.id] = g.saved;
    reach[g.id] = g.target !== null && g.saved >= g.target ? -1 : null;
  }
  const budget0 = baseBudget(plan);
  let bank = plan.startBalance;
  const rows: Row[] = [];
  const conflicts: Conflict[] = [];
  let regularOver = 0;
  let minBank = { i: -1, v: bank };
  const neverPays: string[] = [];

  for (let i = 0; i < months; i++) {
    const card = cardBill(plan.card, i).total;
    const preCard = plan.income - plan.essentials - plan.commitments;
    const budget = preCard - card;
    const shocks = plan.shocks.filter((s) => i >= s.from && i < s.from + s.months);
    const shockOut = shocks.reduce((a, s) => a + s.amount, 0);
    const available = budget - shockOut;

    // pagamentos únicos (antecipação) saem do saldo em conta
    let lump = 0;
    for (const l of plan.lumps.filter((l) => l.month === i)) {
      const x = Math.min(debtBal[l.debtId] ?? 0, l.amount);
      debtBal[l.debtId] -= x;
      totals[l.debtId].paid += x;
      lump += x;
    }

    const pay: Record<string, number> = {};
    const interest: Record<string, number> = {};
    let pool = 0;
    for (const d of plan.debts) {
      pay[d.id] = 0;
      interest[d.id] = 0;
      if (debtBal[d.id] <= EPS) {
        if (plan.snowball && paidAt[d.id] !== undefined && paidAt[d.id] < i) pool += d.payment + d.extra;
        continue;
      }
      const r = (d.rate ?? 0) / 100;
      const int = debtBal[d.id] * r;
      interest[d.id] = int;
      debtBal[d.id] += int;
      const p = Math.min(debtBal[d.id], d.payment + d.extra);
      if (r > 0 && d.payment + d.extra <= int && !neverPays.includes(d.id)) neverPays.push(d.id);
      pay[d.id] = p;
      debtBal[d.id] -= p;
      totals[d.id].interest += int;
      totals[d.id].paid += p;
    }
    // bola de neve: valor liberado vai para a próxima dívida por prioridade
    if (pool > 0) {
      for (const d of sortByPriority(plan.debts)) {
        if (pool <= 0) break;
        if (debtBal[d.id] <= EPS) continue;
        const x = Math.min(debtBal[d.id], pool);
        pay[d.id] += x;
        totals[d.id].paid += x;
        debtBal[d.id] -= x;
        pool -= x;
      }
    }

    const gin: Record<string, number> = {};
    for (const g of plan.goals) {
      const room = g.target === null ? Infinity : Math.max(0, g.target - goalBal[g.id]);
      const c = Math.min(room, goalContribution(g, i));
      gin[g.id] = c;
      goalBal[g.id] += c;
    }
    if (pool > 0) {
      for (const g of sortByPriority(plan.goals)) {
        if (pool <= 0) break;
        if (goalContribution(g, i) === 0 && g.adjust && i >= g.adjust.from && i < g.adjust.from + g.adjust.months) continue;
        const room = g.target === null ? Infinity : Math.max(0, g.target - goalBal[g.id]);
        const x = Math.min(room, pool);
        gin[g.id] += x;
        goalBal[g.id] += x;
        pool -= x;
      }
    }

    const toDebts = Object.values(pay).reduce((a, b) => a + b, 0);
    const toGoals = Object.values(gin).reduce((a, b) => a + b, 0);
    // o que sobrou do pool (sem destino) volta a ser folga: não some
    const free = available - toDebts - toGoals;
    if (free < -EPS) {
      bank += free;
      // "regular": os próprios pagamentos e aportes passam da verba normal (não é fatura atípica nem imprevisto)
      const over = toDebts + toGoals - budget0;
      const regular = shockOut === 0 && over > EPS;
      if (regular) regularOver = Math.max(regularOver, over);
      conflicts.push({
        i,
        amount: -free,
        cause: regular
          ? "Aportes e pagamentos passam da verba do mês"
          : shocks.length
            ? shocks.map((s) => s.label).join(" · ")
            : `Fatura do cartão de ${fmt(card)}`,
      });
    }
    bank -= lump;
    if (bank < minBank.v) minBank = { i, v: bank };

    for (const d of plan.debts) {
      if (payoff[d.id] === null && debtBal[d.id] <= EPS) {
        payoff[d.id] = i;
        paidAt[d.id] = i;
        debtBal[d.id] = 0;
      }
    }
    for (const g of plan.goals) {
      if (reach[g.id] === null && g.target !== null && goalBal[g.id] >= g.target - EPS) reach[g.id] = i;
    }

    const reserves = Object.values(goalBal).reduce((a, b) => a + b, 0);
    const debtTotal = Object.values(debtBal).reduce((a, b) => a + Math.max(0, b), 0);
    rows.push({
      i,
      preCard,
      card,
      budget,
      shockOut,
      available,
      debtPay: pay,
      debtInterest: interest,
      debtBal: { ...debtBal },
      lump,
      goalIn: gin,
      goalBal: { ...goalBal },
      toDebts,
      toGoals,
      free,
      bank,
      reserves,
      debtTotal,
      netWorth: bank + reserves - debtTotal,
    });
  }

  return {
    rows,
    milestones: milestonesFor(plan, rows, payoff, reach),
    payoff,
    reach,
    totals,
    conflicts,
    regularOver,
    minBank,
    neverPays,
  };
}

function milestonesFor(
  plan: Plan,
  rows: Row[],
  payoff: Record<string, number | null>,
  reach: Record<string, number | null>,
): Milestone[] {
  const out: Milestone[] = [];
  for (const d of plan.debts) {
    const at = payoff[d.id];
    if (at === null || at < 0) continue;
    const payments = rows.slice(0, at + 1).filter((r) => r.debtPay[d.id] > 0);
    const last = rows[at].debtPay[d.id];
    const cascaded = rows.slice(0, at + 1).some((r) => r.debtPay[d.id] > d.payment + d.extra + EPS);
    const lump = plan.lumps.filter((l) => l.debtId === d.id).reduce((a, l) => a + l.amount, 0);
    const why = [
      `Saldo devedor de ${fmt(d.balance)}${lump ? `, com ${fmt(lump)} antecipados do saldo em conta` : ""}.`,
      `${payments.length} pagamento${payments.length === 1 ? "" : "s"} de ${fmt(d.payment + d.extra)}${d.extra ? ` (${fmt(d.payment)} + ${fmt(d.extra)} adicionais)` : ""}${cascaded ? ", reforçados por valor liberado de outra dívida" : ""}.`,
      d.rate === null ? "Juros não informados: cálculo com 0% ao mês." : `Juros de ${fmtNum(d.rate)}% ao mês já incluídos.`,
      `Último pagamento em ${monthLong(at)}${Math.abs(last - (d.payment + d.extra)) > EPS ? `, parcela final de ${fmt(last)}` : ""}.`,
    ];
    out.push({ id: "paid-" + d.id, kind: "debt-paid", month: at, refId: d.id, title: `${d.name} quitada`, short: `${d.name} quitada`, why });
  }
  if (plan.debts.length > 1) {
    const ats = plan.debts.map((d) => payoff[d.id]);
    if (ats.every((a) => a !== null)) {
      const at = Math.max(...(ats as number[]));
      if (at >= 0) {
        const freed = plan.debts.reduce((a, d) => a + d.payment + d.extra, 0);
        out.push({
          id: "debts-free",
          kind: "debts-free",
          month: at,
          refId: "debts",
          title: "Nenhuma dívida cadastrada",
          short: "Sem dívidas",
          why: [
            `A última dívida termina em ${monthLong(at)}.`,
            plan.snowball
              ? `A partir de ${monthLong(at + 1)}, ${fmt(freed)}/mês seguem para os objetivos por ordem de prioridade.`
              : `A partir de ${monthLong(at + 1)}, ${fmt(freed)}/mês voltam para a folga livre.`,
          ],
        });
      }
    }
  }
  for (const g of plan.goals) {
    const at = reach[g.id];
    if (at !== null && at >= 0 && g.target !== null) {
      const n = rows.slice(0, at + 1).filter((r) => r.goalIn[g.id] > 0).length;
      const paused = g.adjust
        ? `${g.adjust.amount === 0 ? "Pausa" : `Aporte reduzido para ${fmt(g.adjust.amount)}`} de ${monthShort(g.adjust.from)} a ${monthShort(g.adjust.from + g.adjust.months - 1)}.`
        : null;
      const why = [
        `Faltavam ${fmt(g.target - g.saved)} (${fmt(g.saved)} de ${fmt(g.target)}).`,
        `${n} aporte${n === 1 ? "" : "s"} a partir de ${monthShort(0)}, ${fmt(g.contribution)}/mês no plano.`,
        ...(paused ? [paused] : []),
        `O último aporte completa o valor em ${monthLong(at)}.`,
      ];
      out.push({ id: "reach-" + g.id, kind: "goal-reached", month: at, refId: g.id, title: `${g.name} completa`, short: `${g.name} completa`, why });
    }
    if (g.kind === "reserva") {
      for (const k of [1, 3] as const) {
        const need = plan.essentials * k;
        if (g.saved >= need) continue;
        const r = rows.find((row) => row.goalBal[g.id] >= need - EPS);
        if (!r) continue;
        out.push({
          id: `cover-${k}-${g.id}`,
          kind: k === 1 ? "cover-1" : "cover-3",
          month: r.i,
          refId: g.id,
          title: k === 1 ? "Reserva cobre 1 mês de essenciais" : "Reserva cobre 3 meses de essenciais",
          short: k === 1 ? "1 mês coberto" : "3 meses cobertos",
          why: [
            `Essenciais: ${fmt(plan.essentials)}/mês × ${k} = ${fmt(need)}.`,
            `Reserva projetada em ${monthLong(r.i)}: ${fmt(r.goalBal[g.id])}.`,
          ],
        });
      }
    }
    if (g.kind === "data" && g.due !== null && g.target !== null && rows[g.due]) {
      const v = rows[g.due].goalBal[g.id];
      const missed = v < g.target - EPS;
      out.push({
        id: "due-" + g.id,
        kind: "goal-due",
        month: g.due,
        refId: g.id,
        title: missed ? `${g.name}: data chega com ${fmt(v)}` : `${g.name}: data desejada`,
        short: missed ? `${g.name} · falta ${fmt(g.target - v)}` : g.name,
        missed,
        why: [
          `Data desejada: ${monthLong(g.due)}. Meta de ${fmt(g.target)}.`,
          `Projetado até lá: ${fmt(v)}${missed ? `, faltando ${fmt(g.target - v)}` : ""}.`,
          g.contribution === 0
            ? "Ainda não há aporte recorrente definido."
            : `Aporte de ${fmt(g.contribution)}/mês.`,
          ...(missed ? [`Para chegar: ${fmt(suggestContribution(g))}/mês desde ${monthShort(0)}.`] : []),
        ],
      });
    }
  }
  return out.sort((a, b) => a.month - b.month || a.kind.localeCompare(b.kind));
}

/** Aporte mensal para um objetivo com data: aportes de mês 0 até o mês desejado, inclusive. */
export function suggestContribution(g: Pick<Goal, "saved" | "target" | "due">): number {
  if (g.target === null || g.due === null) return 0;
  const n = g.due + 1;
  return Math.max(0, Math.ceil((g.target - g.saved) / n));
}

export function reserveSuggestion(plan: Plan, months: number) {
  return plan.essentials * months;
}

// ---------------------------------------------------------------- leitura

export type Viability = { level: "ok" | "apertado" | "inviavel"; title: string; detail: string };

export function viability(plan: Plan, pr: Projection, horizon = 24): Viability {
  const within = pr.conflicts.filter((c) => c.i < horizon);
  const minBank = Math.min(...pr.rows.slice(0, horizon).map((r) => r.bank));
  if (pr.regularOver > EPS) {
    return {
      level: "inviavel",
      title: `Passa da verba em ${fmt(pr.regularOver)}/mês`,
      detail: `Pagamentos e aportes somam mais que os ${fmt(baseBudget(plan))} disponíveis. A diferença sairia do saldo em conta todo mês.`,
    };
  }
  if (minBank < 0) {
    return { level: "inviavel", title: "Saldo em conta fica negativo", detail: `Chega a ${fmt(minBank)} na projeção.` };
  }
  if (within.length) {
    const total = within.reduce((a, c) => a + c.amount, 0);
    return {
      level: "apertado",
      title: `${within.length} mês${within.length > 1 ? "es" : ""} sem folga`,
      detail: `Faltam ${fmt(total)} no total (${within.map((c) => monthShort(c.i)).join(", ")}), cobertos pelo saldo em conta.`,
    };
  }
  return { level: "ok", title: "Cabe na verba", detail: "Nenhum mês do horizonte fica sem folga." };
}

export type Decision = {
  id: string;
  tone: "atencao" | "oportunidade" | "info";
  title: string;
  calc: string;
  impact: string;
  action?: { label: string; apply: (p: Plan) => Plan; area?: "dividas" | "objetivos" };
};

export function decisions(plan: Plan, pr: Projection): Decision[] {
  const out: Decision[] = [];
  const reserve = plan.goals.find((g) => g.kind === "reserva");
  const r0 = pr.rows[0];

  const conflict = pr.conflicts[0];
  if (conflict && conflict.i < 24) {
    const r = pr.rows[conflict.i];
    const target = reserve && reserve.contribution > 0 ? reserve : null;
    const cut = target ? Math.min(target.contribution, Math.ceil(conflict.amount)) : 0;
    out.push({
      id: "tight",
      tone: "atencao",
      title:
        r.card > pr.rows[0].card
          ? `A fatura de ${monthShort(conflict.i)} consome toda a folga prevista.`
          : `${monthLong(conflict.i).replace(/^./, (c) => c.toUpperCase())} não tem folga suficiente.`,
      calc: `${fmt(r.preCard)} depois de essenciais e contas fixas − fatura de ${fmt(r.card)}${r.shockOut ? ` − ${fmt(r.shockOut)} de imprevisto` : ""}${r.shockOut ? ` − ${fmt(r.shockOut)} de imprevisto` : ""} − ${fmt(r.toDebts + r.toGoals)} de pagamentos e aportes = ${fmt(r.free)}.`,
      impact: `Sem ajuste, ${fmt(conflict.amount)} saem do saldo em conta nesse mês.`,
      action: target
        ? {
            label: `Simular aporte de ${fmt(target.contribution - cut)} na reserva em ${monthShort(conflict.i)}`,
            apply: (p) => ({
              ...p,
              goals: p.goals.map((g) =>
                g.id === target.id ? { ...g, adjust: { from: conflict.i, months: 1, amount: g.contribution - cut } } : g,
              ),
            }),
          }
        : undefined,
    });
  }

  if (reserve && reserve.saved < plan.essentials) {
    const cover = pr.milestones.find((m) => m.kind === "cover-1" && m.refId === reserve.id);
    out.push({
      id: "cover",
      tone: "atencao",
      title: "Sua reserva ainda não cobre um mês de despesas essenciais.",
      calc: `${fmt(reserve.saved)} guardados ÷ ${fmt(plan.essentials)} de essenciais = ${fmtNum(reserve.saved / plan.essentials, 2)} mês.`,
      impact: cover
        ? `Com ${fmt(reserve.contribution)}/mês, cobre um mês em ${monthLong(cover.month)}.`
        : "Sem aporte, a cobertura não muda.",
      action: { label: "Ver a reserva", apply: (p) => p, area: "objetivos" },
    });
  }

  for (const g of plan.goals) {
    if (g.kind !== "data" || g.due === null || g.target === null) continue;
    const due = pr.milestones.find((m) => m.id === "due-" + g.id);
    if (!due?.missed) continue;
    const need = suggestContribution(g);
    const after = r0.free - need;
    out.push({
      id: "compete-" + g.id,
      tone: after < 0 ? "atencao" : "info",
      title: `${g.name} compete com a folga do mês.`,
      calc: `Faltam ${fmt(g.target - g.saved)} até ${monthShort(g.due)}: ${fmt(g.target - g.saved)} ÷ ${g.due + 1} meses = ${fmt(need)}/mês.`,
      impact:
        after >= 0
          ? `A folga de ${fmt(r0.free)} cai para ${fmt(after)}${pr.rows.some((r) => r.card > r0.card) ? "; meses com fatura maior ficam no vermelho" : ""}.`
          : `Não cabe: a folga atual é ${fmt(r0.free)}. Exige reduzir outro aporte ou adiar a data.`,
      action: {
        label: `Simular ${fmt(need)}/mês para ${g.name.toLowerCase()}`,
        apply: (p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, contribution: need } : x)) }),
      },
    });
  }

  const unknown = plan.debts.filter((d) => d.rate === null && d.balance > 0);
  if (unknown.length) {
    const first = sortByPriority(plan.debts)[0];
    out.push({
      id: "rates",
      tone: "info",
      title: unknown.length > 1 ? "Os juros das dívidas não foram informados." : `Os juros da ${unknown[0].name} não foram informados.`,
      calc: `Sem taxa, a ordem sugerida é pelo menor saldo: ${first.name} (${fmt(first.balance)}) primeiro.`,
      impact: "Com a taxa, a prioridade passa a ser a dívida mais cara, e o total pago deixa de ser igual ao principal.",
      action: { label: "Informar juros", apply: (p) => p, area: "dividas" },
    });
  } else {
    const rated = plan.debts.filter((d) => (d.rate ?? 0) > 0);
    if (rated.length > 1) {
      const top = [...rated].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0];
      const prio = sortByPriority(plan.debts)[0];
      if (top.id !== prio.id) {
        out.push({
          id: "rate-order",
          tone: "oportunidade",
          title: `${top.name} tem juros maiores do que as demais.`,
          calc: `${fmtNum(top.rate ?? 0)}% ao mês contra ${fmtNum(prio.rate ?? 0)}% da ${prio.name}.`,
          impact: "Priorizá-la reduz o total pago em juros quando houver valor extra ou liberado.",
          action: {
            label: `Priorizar ${top.name}`,
            apply: (p) => ({
              ...p,
              debts: p.debts.map((d) => ({ ...d, priority: d.id === top.id ? 0 : d.priority + 1 })),
            }),
          },
        });
      }
    }
  }

  const ending = plan.card.installments
    .filter((p) => !p.simulated && installmentEnd(p) >= 0 && installmentEnd(p) < 12)
    .sort((a, b) => installmentEnd(a) - installmentEnd(b))[0];
  if (ending) {
    const at = installmentEnd(ending) + 1;
    out.push({
      id: "card-end",
      tone: "oportunidade",
      title: `Em ${monthLong(at)}, a fatura cai ${fmt(ending.amount)}: termina a parcela de ${ending.label.toLowerCase()}.`,
      calc: `Fatura de ${monthShort(at - 1)}: ${fmt(pr.rows[at - 1].card)} → ${monthShort(at)}: ${fmt(pr.rows[at]?.card ?? 0)}.`,
      impact: "Sem destino, o valor vira folga livre. Dá para decidir agora para onde ele vai.",
    });
  }

  const free = pr.milestones.find((m) => m.kind === "debts-free");
  if (free && !plan.snowball) {
    const freed = plan.debts.reduce((a, d) => a + d.payment + d.extra, 0);
    out.push({
      id: "freed",
      tone: "oportunidade",
      title: `Em ${monthLong(free.month + 1)}, ${fmt(freed)} deixam de ir para dívidas.`,
      calc: `Soma dos pagamentos que terminam: ${plan.debts.map((d) => fmt(d.payment + d.extra)).join(" + ")}.`,
      impact: "Sem destino, viram folga livre. Direcionar para os objetivos antecipa as conquistas.",
      action: { label: "Simular: valor liberado vai para os objetivos", apply: (p) => ({ ...p, snowball: true }) },
    });
  }
  return out;
}

// ---------------------------------------------------------------- comparação

export type DiffItem = {
  id: string;
  label: string;
  before: string;
  after: string;
  /** >0 melhorou, <0 piorou, 0 neutro */
  sense: number;
  delta?: string;
};

const monthOrNever = (i: number | null | undefined) =>
  i === null || i === undefined ? "depois de " + monthShort(PROJECTION_MONTHS - 1) : i < 0 ? "já" : monthShort(i);

function monthDelta(a: number | null, b: number | null): { sense: number; delta?: string } {
  if (a === b) return { sense: 0 };
  if (a === null) return { sense: 1, delta: "passa a acontecer" };
  if (b === null) return { sense: -1, delta: "sai do horizonte" };
  const d = b - a;
  const n = Math.abs(d);
  return { sense: d < 0 ? 1 : -1, delta: `${d < 0 ? "−" : "+"}${n} ${n === 1 ? "mês" : "meses"}` };
}

export function compare(a: Projection, pb: Plan, b: Projection, horizon: number): DiffItem[] {
  const out: DiffItem[] = [];
  for (const d of pb.debts) {
    const before = a.payoff[d.id] ?? null;
    const after = b.payoff[d.id] ?? null;
    const md = monthDelta(before, after);
    if (md.sense !== 0 || !(d.id in a.payoff)) out.push({ id: "p-" + d.id, label: `Quitação · ${d.name}`, before: monthOrNever(before), after: monthOrNever(after), ...md });
  }
  for (const g of pb.goals) {
    if (g.target === null) continue;
    const before = a.reach[g.id] ?? null;
    const after = b.reach[g.id] ?? null;
    const md = monthDelta(before, after);
    if (md.sense !== 0 || !(g.id in a.reach)) out.push({ id: "g-" + g.id, label: `${g.name} completa`, before: g.id in a.reach ? monthOrNever(before) : "—", after: monthOrNever(after), ...md });
  }
  const fa = a.rows[0].free;
  const fb = b.rows[0].free;
  if (Math.round(fa) !== Math.round(fb))
    out.push({ id: "free", label: `Folga livre em ${monthShort(0)}`, before: fmt(fa), after: fmt(fb), sense: Math.sign(fb - fa), delta: fmtSigned(fb - fa) });
  const minA = Math.min(...a.rows.slice(0, horizon).map((r) => r.free));
  const minB = Math.min(...b.rows.slice(0, horizon).map((r) => r.free));
  if (Math.round(minA) !== Math.round(minB))
    out.push({ id: "min", label: "Mês mais apertado", before: fmt(minA), after: fmt(minB), sense: Math.sign(minB - minA), delta: fmtSigned(minB - minA) });
  const ba = Math.min(...a.rows.slice(0, horizon).map((r) => r.bank));
  const bb = Math.min(...b.rows.slice(0, horizon).map((r) => r.bank));
  if (Math.round(ba) !== Math.round(bb))
    out.push({ id: "bank", label: "Menor saldo em conta", before: fmt(ba), after: fmt(bb), sense: Math.sign(bb - ba), delta: fmtSigned(bb - ba) });
  const h = horizon - 1;
  const na = a.rows[h].netWorth;
  const nb = b.rows[h].netWorth;
  if (Math.round(na) !== Math.round(nb))
    out.push({ id: "nw", label: `Patrimônio em ${monthShort(h)}`, before: fmt(na), after: fmt(nb), sense: Math.sign(nb - na), delta: fmtSigned(nb - na) });
  const ia = Object.values(a.totals).reduce((s, t) => s + t.interest, 0);
  const ib = Object.values(b.totals).reduce((s, t) => s + t.interest, 0);
  if (Math.round(ia) !== Math.round(ib))
    out.push({ id: "int", label: "Juros pagos no total", before: fmt(ia), after: fmt(ib), sense: Math.sign(ia - ib), delta: fmtSigned(ib - ia) });
  return out;
}

export function describeChanges(a: Plan, b: Plan): string[] {
  const out: string[] = [];
  for (const d of b.debts) {
    const o = a.debts.find((x) => x.id === d.id);
    if (!o) {
      out.push(`Nova dívida: ${d.name}, ${fmt(d.balance)}`);
      continue;
    }
    if (o.payment + o.extra !== d.payment + d.extra)
      out.push(`${d.name}: ${fmt(o.payment + o.extra)} → ${fmt(d.payment + d.extra)}/mês`);
    if (o.rate !== d.rate) out.push(`${d.name}: juros ${o.rate === null ? "não informados" : fmtNum(o.rate) + "%"} → ${d.rate === null ? "não informados" : fmtNum(d.rate) + "% a.m."}`);
  }
  const prio = (p: Plan) => sortByPriority(p.debts).map((d) => d.id).join();
  if (prio(a) !== prio(b)) out.push(`Ordem das dívidas: ${sortByPriority(b.debts).map((d) => d.name).join(" → ")}`);
  for (const g of b.goals) {
    const o = a.goals.find((x) => x.id === g.id);
    if (!o) {
      out.push(`Novo objetivo: ${g.name}`);
      continue;
    }
    if (o.contribution !== g.contribution) out.push(`${g.name}: aporte ${fmt(o.contribution)} → ${fmt(g.contribution)}/mês`);
    if (JSON.stringify(o.adjust) !== JSON.stringify(g.adjust) && g.adjust)
      out.push(
        `${g.name}: ${g.adjust.amount === 0 ? "pausa" : `aporte de ${fmt(g.adjust.amount)}`} ${g.adjust.months > 1 ? `de ${monthShort(g.adjust.from)} a ${monthShort(g.adjust.from + g.adjust.months - 1)}` : `em ${monthShort(g.adjust.from)}`}`,
      );
    if (o.target !== g.target) out.push(`${g.name}: meta ${o.target === null ? "aberta" : fmt(o.target)} → ${g.target === null ? "aberta" : fmt(g.target)}`);
    if (o.due !== g.due && g.due !== null) out.push(`${g.name}: data ${o.due === null ? "sem data" : monthShort(o.due)} → ${monthShort(g.due)}`);
  }
  const gprio = (p: Plan) => sortByPriority(p.goals).map((d) => d.id).join();
  if (gprio(a) !== gprio(b)) out.push(`Ordem dos objetivos: ${sortByPriority(b.goals).map((g) => g.name).join(" → ")}`);
  for (const s of b.shocks)
    if (!a.shocks.find((x) => x.id === s.id))
      out.push(s.kind === "despesa" ? `Imprevisto de ${fmt(s.amount)} em ${monthShort(s.from)}` : `Receita ${fmt(-s.amount)}/mês por ${s.months} meses desde ${monthShort(s.from)}`);
  for (const l of b.lumps)
    if (!a.lumps.find((x) => x.debtId === l.debtId && x.month === l.month))
      out.push(`Antecipar ${fmt(l.amount)} da ${b.debts.find((d) => d.id === l.debtId)?.name} em ${monthShort(l.month)}, do saldo em conta`);
  for (const p of b.card.installments)
    if (!a.card.installments.find((x) => x.id === p.id))
      out.push(`Compra no cartão: ${p.label}, ${p.total}× de ${fmt(p.amount)} desde ${monthShort(p.start)}`);
  if (a.card.variableAvg !== b.card.variableAvg) out.push(`Gasto do dia a dia no cartão: ${fmt(a.card.variableAvg)} → ${fmt(b.card.variableAvg)}/mês`);
  if (a.snowball !== b.snowball) out.push(b.snowball ? "Valor de dívida quitada segue para a próxima prioridade" : "Valor de dívida quitada volta para a folga");
  return out;
}

export const samePlan = (a: Plan, b: Plan) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- cenários prontos

export type WhatIf = {
  id: string;
  label: string;
  /** null = aplicável; string = motivo de não se aplicar */
  blocked: (p: Plan) => string | null;
  apply: (p: Plan) => Plan;
};

export const WHAT_IFS: WhatIf[] = [
  {
    id: "extra-a",
    label: "Pagar R$ 200 a mais na Dívida A",
    blocked: (p) => (p.debts.find((d) => d.id === "a") ? null : "Dívida A não existe"),
    apply: (p) => ({ ...p, debts: p.debts.map((d) => (d.id === "a" ? { ...d, extra: d.extra + 200 } : d)) }),
  },
  {
    id: "trip-300",
    label: "Guardar R$ 300/mês para a viagem",
    blocked: () => null,
    apply: (p) => ({ ...p, goals: p.goals.map((g) => (g.id === "viagem" ? { ...g, contribution: 300 } : g)) }),
  },
  {
    id: "pause-trip",
    label: "Pausar a viagem por 3 meses",
    blocked: (p) => ((p.goals.find((g) => g.id === "viagem")?.contribution ?? 0) > 0 ? null : "A viagem ainda não tem aporte para pausar"),
    apply: (p) => ({ ...p, goals: p.goals.map((g) => (g.id === "viagem" ? { ...g, adjust: { from: 1, months: 3, amount: 0 } } : g)) }),
  },
  {
    id: "lump-b",
    label: "Quitar a Dívida B agora com o saldo em conta",
    blocked: (p) => {
      const b = p.debts.find((d) => d.id === "b");
      if (!b) return "Dívida B não existe";
      return p.startBalance >= b.balance ? null : "Saldo em conta não cobre";
    },
    apply: (p) => ({ ...p, lumps: [...p.lumps.filter((l) => l.debtId !== "b"), { debtId: "b", month: 0, amount: p.debts.find((d) => d.id === "b")!.balance }] }),
  },
  {
    id: "shock",
    label: "Despesa inesperada de R$ 1.500 em março",
    blocked: () => null,
    apply: (p) => ({ ...p, shocks: [...p.shocks.filter((s) => s.id !== "shock"), { id: "shock", kind: "despesa", from: 3, months: 1, amount: 1500, label: "Imprevisto de R$ 1.500" }] }),
  },
  {
    id: "income",
    label: "Receita R$ 1.000 menor por 3 meses",
    blocked: () => null,
    apply: (p) => ({ ...p, shocks: [...p.shocks.filter((s) => s.id !== "income"), { id: "income", kind: "receita", from: 2, months: 3, amount: 1000, label: "Receita menor" }] }),
  },
  {
    id: "swap",
    label: "Viagem antes da reserva, com o valor liberado das dívidas",
    blocked: () => null,
    apply: (p) => ({
      ...p,
      snowball: true,
      goals: p.goals.map((g) => (g.id === "viagem" ? { ...g, priority: 0 } : g.id === "reserva" ? { ...g, priority: 1 } : g)),
    }),
  },
];

// ---------------------------------------------------------------- edição

export const setDebt = (p: Plan, id: string, patch: Partial<Debt>): Plan => ({
  ...p,
  debts: p.debts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
});
export const setGoal = (p: Plan, id: string, patch: Partial<Goal>): Plan => ({
  ...p,
  goals: p.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)),
});
/** Soma do que já está alocado por mês, sem extras sazonais. */
export const allocatedRegular = (p: Plan) =>
  p.debts.reduce((a, d) => a + (d.balance > 0 ? d.payment + d.extra : 0), 0) + p.goals.reduce((a, g) => a + g.contribution, 0);
