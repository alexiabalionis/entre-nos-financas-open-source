import { brDate } from "../../src/domain/format.ts";
import type { Frequency } from "../../src/domain/recurrence.ts";
import { monthTitle } from "../lib/dates.ts";
import { money } from "../lib/money.ts";
import {
  fixedState,
  isRealized,
  shownCents,
  type FixedState,
  type StatusItem,
} from "./fixed-status.ts";

export type FixedAction =
  | "edit-series"
  | "only-this"
  | "this-and-next"
  | "all"
  | "since"
  | "move-month"
  | "change-due"
  | "skip"
  | "end"
  | "delete";

export type ActionEntry = {
  id: FixedAction;
  title: string;
  hint: string;
  enabled: boolean;
};

export type ActionMenu = {
  summary: string;
  entries: ActionEntry[];
  blockedNote: string | null;
};

export type MenuItem = StatusItem & {
  month: string;
  recurrence: { frequency: Frequency; every: number; end_date?: string | null };
};

const UNITS: Record<Frequency, [string, string, string]> = {
  day: ["todo dia", "dias", "dia"],
  week: ["toda semana", "semanas", "semana"],
  month: ["todo mês", "meses", "mês"],
  year: ["todo ano", "anos", "ano"],
};

/** "novembro", a partir da competência do item ("2026-11-01"). */
export function monthName(month: string): string {
  return monthTitle(month.slice(0, 7)).split(" de ")[0];
}

export function frequencyText(frequency: Frequency, every: number): string {
  const [each, plural] = UNITS[frequency];
  return every === 1 ? each : `a cada ${every} ${plural}`;
}

const BLOCKED_BY: Partial<Record<FixedState, string>> = {
  reconciled: "já está conciliada com o banco",
  partial: "já teve um pagamento",
};

export function blockedNote(item: StatusItem): string {
  const why = BLOCKED_BY[fixedState(item)] ?? "já foi paga";
  return `Esta conta ${why}, por isso não dá para mudar o mês, o vencimento, pular nem excluir. Editar e encerrar continuam disponíveis.`;
}

function summaryLine(item: MenuItem, hidden: boolean): string {
  const realized = isRealized(item);
  const due = item.due_date
    ? `${realized ? "vencia" : "vence"} em ${brDate(item.due_date).slice(0, 5)}`
    : "sem vencimento";
  const { frequency, every } = item.recurrence;
  const end = item.recurrence.end_date ? ` · termina em ${brDate(item.recurrence.end_date)}` : "";
  return `${money(shownCents(item), item.currency, hidden)} · ${due} · conta fixa, ${frequencyText(frequency, every)}${end}`;
}

/** Ações do toque numa conta fixa: quais existem, quais estão habilitadas e por quê. */
export function actionMenu(
  item: MenuItem,
  hidden: boolean,
  reader: boolean,
): ActionMenu {
  const summary = summaryLine(item, hidden);
  if (reader) return { summary, entries: [], blockedNote: null };
  const name = monthName(item.month);
  const open = !isRealized(item);
  const entries: ActionEntry[] = [
    { id: "edit-series", title: "Editar conta fixa", hint: "Nome, valor, categoria, frequência e fim, desta em diante", enabled: true },
    { id: "only-this", title: "Editar só esta", hint: `Muda apenas ${name}`, enabled: true },
    { id: "this-and-next", title: "Esta e as próximas", hint: `Muda ${name} e os meses seguintes`, enabled: true },
    { id: "all", title: "Todas", hint: "Muda o valor em todos os meses, também nos anteriores", enabled: true },
    { id: "since", title: "Desde quando é fixa", hint: "Inclui meses anteriores, como pagos", enabled: true },
    { id: "move-month", title: "Mudar o mês em que conta", hint: "Faz esta conta cair em outro mês", enabled: open },
    { id: "change-due", title: "Mudar o vencimento", hint: `Troca o dia, sempre dentro de ${name}`, enabled: open },
    { id: "skip", title: "Pular esta", hint: `Não conta em ${name} e não volta`, enabled: open },
    { id: "end", title: "Encerrar", hint: "Escolha até quando ela vale", enabled: true },
    { id: "delete", title: "Excluir conta fixa", hint: "Some de todos os meses, se nada foi pago ainda", enabled: open },
  ];
  return { summary, entries, blockedNote: open ? null : blockedNote(item) };
}

export function skipDone(label: string, month: string): string {
  return `${label} de ${monthName(month)} foi pulado. Os meses seguintes continuam normais.`;
}

export function onlyThisDone(month: string): string {
  return `Salvo. Só ${monthName(month)} mudou.`;
}
