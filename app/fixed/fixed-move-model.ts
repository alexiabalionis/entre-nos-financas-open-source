import { brDate } from "../../src/domain/format.ts";
import { moveMonth, monthTitle } from "../lib/dates.ts";
import { monthName } from "./fixed-actions-model.ts";

export type DueMode = "pick" | "none";
export type MoveForm = { month: string; dueMode: DueMode; due: string };
type Target = { id: string; version: number; month: string; due_date: string | null };

const OFFSETS = [1, 2, 3, -1, -2];

function capital(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

/** Meses para onde a conta pode ir, sem o mês em que ela já está. */
export function moveTargets(month: string): { value: string; label: string }[] {
  return OFFSETS.map((n) => moveMonth(month.slice(0, 7), n)).map((value) => ({
    value,
    label: capital(monthTitle(value)),
  }));
}

export function monthBounds(month: string): { first: string; last: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, "0")}` };
}

/** Recusa vencimento fora do mês sem oferecer trocar o mês: isso é outra ação. */
export function dueError(due: string, month: string): string | null {
  if (!due || due.startsWith(month + "-")) return null;
  const { first, last } = monthBounds(month);
  return `Esse dia fica fora de ${monthTitle(month)}. Escolha uma data entre ${brDate(first)} e ${brDate(last)}.`;
}

export function dueReady(due: string, month: string): boolean {
  return due !== "" && dueError(due, month) === null;
}

/** Só pergunta do vencimento quando a conta tem um; nunca calculamos o dia por conta própria. */
export function asksDue(item: Pick<Target, "due_date">): boolean {
  return item.due_date !== null;
}

export function moveReady(form: MoveForm, item: Pick<Target, "due_date">): boolean {
  if (!asksDue(item) || form.dueMode === "none") return true;
  return dueReady(form.due, form.month);
}

export function moveHint(form: MoveForm, item: Pick<Target, "due_date">): string | null {
  return moveReady(form, item)
    ? null
    : 'Escolha um dia dentro do novo mês ou marque "Sem vencimento" para continuar.';
}

export function movePayload(item: Target, form: MoveForm) {
  const keepsDue = asksDue(item) && form.dueMode === "pick";
  return {
    item_id: item.id,
    version: item.version,
    month: form.month,
    due_date: keepsDue ? form.due : null,
  };
}

export function movedNotice(label: string, month: string): string {
  return `${label} agora conta em ${monthName(month + "-01")}. O mês de origem não cria outra no lugar.`;
}

export function dueChangedNotice(due: string): string {
  return `Vencimento mudado para ${brDate(due)}.`;
}
