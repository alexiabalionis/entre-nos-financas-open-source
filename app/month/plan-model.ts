import type { MonthItem } from "../hooks/use-month-data.ts";
import { planGroup } from "../../src/domain/dashboard.ts";
import { brDate } from "../../src/domain/format.ts";

export const PLAN_GROUPS = [
  {
    id: "income",
    title: "Entradas",
    description: "O que esperamos receber",
    action: "Planejar entrada",
  },
  {
    id: "fixed",
    title: "Custos fixos",
    description: "Compromissos recorrentes da casa",
    action: "Planejar custo fixo",
  },
  {
    id: "variable",
    title: "Custos variáveis",
    description: "Gastos do dia a dia e valores que variam",
    action: "Planejar custo variável",
  },
  {
    id: "saving",
    title: "Reservas e objetivos",
    description: "Dinheiro guardado, separado dos gastos",
    action: "Planejar reserva",
  },
] as const;

export type PlanGroupId = (typeof PLAN_GROUPS)[number]["id"];

export function itemsInGroup(
  items: MonthItem[],
  groupId: PlanGroupId,
): MonthItem[] {
  return items.filter((i) => {
    return planGroup(i) === groupId;
  });
}

export function plannedTotal(list: MonthItem[], paid = false): bigint {
  return list.reduce(
    (n, i) =>
      n +
      BigInt(
        (paid
          ? i.status === "open"
            ? "0"
            : (i.paid_cents ?? (i.status === "done" ? i.planned_cents : "0"))
          : i.planned_cents) ?? "0",
      ),
    0n,
  );
}

export function itemStatusText(item: MonthItem, today: string): string {
  const status =
    item.status === "done"
      ? item.purpose === "income"
        ? "Recebido"
        : item.purpose === "saving"
          ? "Reservado"
          : "Pago"
      : item.status === "partial"
        ? item.purpose === "income"
          ? "Recebido em parte"
          : "Pago em parte"
        : item.due_date
          ? (item.due_date < today ? "Venceu em " : "Previsto para ") +
            brDate(item.due_date)
          : "Sem data definida";
  return status + (item.purpose === "benefit" ? " · Benefício" : "");
}

/**
 * Valor marcado como pago sem lançamento associado (despesa ou benefício, parcial
 * ou concluído, sem `event_id`). Só informa: não entra no consumo nem no
 * comprometimento. Quando a linha do banco chega, o gasto passa a contar por ela.
 */
export function paidWithoutEntryCents(item: MonthItem): bigint {
  if (item.purpose !== "expense" && item.purpose !== "benefit") return 0n;
  if (item.derived || item.event_id !== null) return 0n;
  if (item.status !== "partial" && item.status !== "done") return 0n;
  const paid = BigInt(
    item.paid_cents ?? (item.status === "done" ? (item.planned_cents ?? "0") : "0"),
  );
  return paid > 0n ? paid : 0n;
}
