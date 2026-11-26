// Motor PURO da tela Mês (vitrine do DS). Portado de work/prototipos-mes/
// refino-v2/d-model.js, mas re-ancorado no SHAPE REAL dos dados do produto
// (MonthlyItem de src/server/routine.ts), não no shape de demonstração do
// protótipo. Sem React, sem DOM, sem "use client": é lógica testável.
//
// DIFERENÇA DELIBERADA EM RELAÇÃO AO d-model.js: o protótipo simula o caixa
// dia-a-dia a partir de `events`, `opening`, `bankPending` e ciclos de cartão
// — nada disso existe em MonthlyItem[] (o contrato só traz plano por item:
// planned/paid/status/due_date/purpose). Então o port é FIEL ao que o dado
// permite: classificação de cenário + agregados em centavos. Tudo em BigInt
// para não perder centavo (os valores chegam como string de centavos).
import type { MonthlyItem } from "../src/server/routine.ts";

/** Cenário do mês, mesma taxonomia do protótipo. */
export type MonthScenario =
  | "positivo"
  | "risco"
  | "insuficiente"
  | "futuro"
  | "encerrado";

/** Tom semântico do DS derivado do cenário (sem escolher cor crua). */
export type ScenarioTone = "ok" | "warn" | "danger" | "accent" | "neutral";

/** Resultado da análise. Valores monetários são STRING DE CENTAVOS (BigInt
 *  serializado), preservando a precisão exata do contrato. */
export type MonthAnalysis = {
  scenario: MonthScenario;
  tone: ScenarioTone;
  /** Mês navegável anterior/seguinte (YYYY-MM). */
  prevMonth: string;
  nextMonth: string;
  /** Entradas planejadas somadas (centavos). */
  incomePlanned: string;
  /** Contas/cartão/reserva ainda em aberto (centavos). */
  committed: string;
  /** Contas/cartão/reserva já pagas (centavos). */
  billsPaid: string;
  /** Sobra prevista = entradas − saídas planejadas (centavos, pode ser neg). */
  leftover: string;
  /** "Disponível nesta semana": fatia semanal da sobra, nunca negativa
   *  (centavos). null quando o cenário é insuficiente/futuro/encerrado. */
  weekAvailable: string | null;
  /** Itens sem valor definido (planned_cents null) — tornam o mês parcial. */
  unknownItems: MonthlyItem[];
  /** Compromissos em aberto vencidos (due_date antes de hoje). */
  overdueItems: MonthlyItem[];
  /** O mês tem lacunas (algum item em aberto sem valor). */
  partial: boolean;
};

/** Util de data PURO (moveMonth não é exportado por family.tsx): avança n
 *  meses sobre um 'YYYY-MM' e devolve outro 'YYYY-MM'. */
export function moveMonth(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10).slice(0, 7);
}

/** Soma BigInt de centavos sobre os planned_cents de uma lista de itens. */
function sumPlanned(items: MonthlyItem[]): bigint {
  return items.reduce(
    (acc, i) => acc + (i.planned_cents === null ? 0n : BigInt(i.planned_cents)),
    0n,
  );
}

const INCOME = (i: MonthlyItem) => i.purpose === "income";
const OUTFLOW = (i: MonthlyItem) =>
  i.purpose === "expense" || i.purpose === "card" || i.purpose === "saving";
const OPEN = (i: MonthlyItem) => i.status !== "done" && !i.bank_cover;

/**
 * Analisa o mês a partir dos itens do plano. `today` é a data de referência
 * ('YYYY-MM-DD', default: data real) e `status` diz se o mês já começou. Puro:
 * mesma entrada → mesma saída.
 */
export function analyzeMonth(
  items: MonthlyItem[],
  month: string,
  opts: { today?: string; status?: "current" | "closed" | "future" } = {},
): MonthAnalysis {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  // Deriva o status do mês quando não informado, comparando com a data de hoje.
  const monthKey = today.slice(0, 7);
  const status =
    opts.status ??
    (month < monthKey ? "closed" : month > monthKey ? "future" : "current");

  const income = items.filter(INCOME);
  const bills = items.filter(OUTFLOW);
  const unknownItems = items.filter((i) => OPEN(i) && i.planned_cents === null);
  const overdueItems =
    status === "current"
      ? bills.filter(
          (i) => OPEN(i) && i.due_date !== null && i.due_date < today,
        )
      : [];

  const incomePlanned = sumPlanned(income);
  const billsPaid = sumPlanned(bills.filter((i) => !OPEN(i)));
  const committed = sumPlanned(bills.filter(OPEN));
  const leftover = incomePlanned - sumPlanned(bills);
  const partial = unknownItems.length > 0;

  // Cenário: futuro/encerrado vêm do status; nos meses em andamento, o aperto
  // vem do dado disponível — sobra negativa ou dado faltando = risco/insuf.
  let scenario: MonthScenario;
  if (status === "future") scenario = "futuro";
  else if (status === "closed") scenario = "encerrado";
  else if (incomePlanned === 0n || partial) scenario = "insuficiente";
  else if (leftover < 0n) scenario = "risco";
  else scenario = "positivo";

  const tone: ScenarioTone =
    scenario === "positivo"
      ? "ok"
      : scenario === "risco"
        ? "danger"
        : scenario === "insuficiente"
          ? "warn"
          : "neutral";

  // "Disponível nesta semana": no mês em andamento e saudável, uma fatia
  // semanal da sobra prevista (proporcional aos dias restantes do mês), nunca
  // negativa. Tudo em centavos inteiros. Sem simular dia-a-dia (o contrato não
  // traz eventos/saldo de abertura), é a leitura possível do plano.
  let weekAvailable: string | null = null;
  if (scenario === "positivo" || scenario === "risco") {
    const day = Number(today.slice(8, 10));
    const [y, m] = month.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const daysLeft = Math.max(1, daysInMonth - day + 1);
    const base = leftover > 0n ? leftover : 0n;
    // fatia de 7 dias do que resta, arredondada para baixo ao centavo.
    const slice = (base * 7n) / BigInt(daysLeft);
    weekAvailable = slice.toString();
  }

  return {
    scenario,
    tone,
    prevMonth: moveMonth(month, -1),
    nextMonth: moveMonth(month, 1),
    incomePlanned: incomePlanned.toString(),
    committed: committed.toString(),
    billsPaid: billsPaid.toString(),
    leftover: leftover.toString(),
    weekAvailable,
    unknownItems,
    overdueItems,
    partial,
  };
}
