import type { FutureInput, MonthAmount } from "../../src/domain/future-months.ts";

// Cenário do briefing do Copiloto Futuro, em centavos, para testes e vitrine.
// Mês 0 = dezembro de 2026. As dívidas do protótipo não existem no modelo real:
// os R$ 700 de pagamentos entram como conta fixa, para reproduzir o briefing
// (só jan/27 fica sem folga). Os essenciais também entram como conta fixa.

const START = "2026-12";
const MONTHS = 24;

function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y * 12 + m - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
const month = (i: number) => addMonths(START, i);

const monthly = (label: string, cents: bigint): MonthAmount[] =>
  Array.from({ length: MONTHS }, (_, i) => ({
    month: month(i),
    cents,
    items: [{ key: label, label, cents, source: "recorrencia" as const }],
  }));

const CYCLE = {
  closing_day: 13,
  due_day: 20,
  due_month_offset: 0 as const,
  valid_from: "2026-01-01",
  valid_until: null,
};

/** Fatura do mês i: recorrentes 230 + dia a dia 650 + parcelas + compras de fim de ano (jan). */
const BILLS = [130000n, 185000n, 130000n, 114000n, 114000n, 114000n, 114000n];

export function briefingInput(): FutureInput {
  const bills = Array.from({ length: MONTHS }, (_, i) => ({
    month: month(i),
    total: i < BILLS.length ? BILLS[i] : 88000n,
    quality: "estimated" as const,
    source: "estimado" as const,
    ...(i === 0 ? { leftoverCategories: [{ name: "Pet", cents: 5000n }, { name: "Lazer", cents: 3000n }] } : {}),
  }));
  const geladeira = Array.from({ length: 7 }, (_, i) => ({
    key: "geladeira",
    label: "Geladeira",
    cents: 26000n,
    k: 4 + i,
    n: 10,
    month: month(i),
    lastMonth: month(6),
  }));
  const oculos = Array.from({ length: 3 }, (_, i) => ({
    key: "oculos",
    label: "Óculos",
    cents: 16000n,
    k: 4 + i,
    n: 6,
    month: month(i),
    lastMonth: month(2),
  }));
  const recurring = Array.from({ length: MONTHS }, (_, i) => [
    { key: "assinaturas", label: "Assinaturas e apps", cents: 12000n, month: month(i) },
    { key: "academia", label: "Academia", cents: 11000n, month: month(i) },
  ]).flat();
  return {
    today: "2026-12-01",
    startMonth: START,
    months: MONTHS,
    startBalance: 410000n,
    snapshotDate: "2026-12-01",
    income: monthly("Salário", 600000n),
    fixed: [
      ...monthly("Essenciais", 240000n),
      ...monthly("Contas fixas", 70000n),
      ...monthly("Pagamentos de dívida", 70000n),
    ],
    everyday: { weekly: null, source: "ausente" },
    cards: [
      {
        card: "cartao",
        name: "Cartão principal",
        cycles: [CYCLE],
        bills,
        installments: [...geladeira, ...oculos],
        recurring,
      },
    ],
    goals: [
      {
        id: "reserva",
        name: "Reserva de emergência",
        status: "active",
        location: "elsewhere",
        target: 1000000n,
        saved: 230000n,
        deadlineMonth: null,
        priority: 1,
        plans: [{ month: START, planned: 50000n }],
      },
      {
        id: "viagem",
        name: "Viagem",
        status: "active",
        location: "elsewhere",
        target: 400000n,
        saved: 90000n,
        deadlineMonth: "2027-12",
        priority: 2,
        plans: [],
      },
    ],
    essentialsMonthly: 240000n,
  };
}

/** Sem entrada, cartão nem objetivos: serve para testar os estados vazios. */
export function emptyInput(): FutureInput {
  return {
    today: "2026-12-01",
    startMonth: START,
    months: MONTHS,
    startBalance: 0n,
    snapshotDate: null,
    income: [],
    fixed: [],
    everyday: { weekly: null, source: "ausente" },
    cards: [],
    goals: [],
    essentialsMonthly: 0n,
  };
}
