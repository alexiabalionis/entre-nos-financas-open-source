import { cents } from "../../src/domain/finance.ts";
import type { Tone } from "../ds/shared.ts";
import { monthTitle } from "../lib/dates.ts";
import { money } from "../lib/money.ts";
import type { PreviewEntry } from "../../src/server/recurrence-series.ts";

export type { PreviewEntry };
export type GroupName = "replaced" | "edited" | "preserved" | "cancelled";
export type PreviewGroups = Record<GroupName, PreviewEntry[]>;
export type Preview = {
  recurrence_id: string;
  from: string;
  groups: PreviewGroups;
};
export type PreviewMode = "next" | "end";
export type Choice = "replace" | "keep";
export type Decisions = Record<string, Choice>;
export type PreviewRow = {
  group: GroupName;
  tone: Tone;
  count: number;
  title: string;
  detail: string;
};
export type NewAmount = { cents: number } | { error: string };

const MAX_MONTHS = 6;

export function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

function capital(text: string): string {
  return text[0].toUpperCase() + text.slice(1);
}

/** "Janeiro de 2027", do dia da ocorrência. */
export function entryMonth(entry: Pick<PreviewEntry, "occurrence_date">): string {
  return capital(monthTitle(entry.occurrence_date.slice(0, 7)));
}

/** Meses sem repetir (uma série diária cai várias vezes no mesmo mês), no máximo seis. */
export function monthsText(entries: PreviewEntry[]): string {
  const months = [
    ...new Set(entries.map((e) => monthTitle(e.occurrence_date.slice(0, 7)))),
  ];
  const shown = months.slice(0, MAX_MONTHS);
  const extra = months.length - shown.length;
  const list =
    shown.length > 1
      ? `${shown.slice(0, -1).join(", ")} e ${shown[shown.length - 1]}`
      : shown[0];
  return capital(extra > 0 ? `${list} e mais ${extra} ${plural(extra, "mês", "meses")}` : list);
}

const TONES: Record<GroupName, Tone> = {
  replaced: "accent",
  preserved: "ok",
  cancelled: "neutral",
  edited: "warn",
};

function rowTitle(group: GroupName, mode: PreviewMode, n: number): string {
  const one = n === 1;
  if (group === "edited") return "você ajustou à mão";
  if (group === "preserved")
    return one ? "já paga ou conciliada, fica como está" : "já pagas ou conciliadas, ficam como estão";
  if (group === "cancelled")
    return one ? "pulada, continua pulada" : "puladas, continuam puladas";
  if (mode === "end") return one ? "sai do plano" : "saem do plano";
  return one ? "será atualizada" : "serão atualizadas";
}

function rowDetail(group: GroupName, entries: PreviewEntry[], change: string): string {
  if (group === "edited")
    return "Decida uma por uma. Nada muda nelas sem a sua escolha.";
  return `${monthsText(entries)}.${group === "replaced" ? change : ""}`;
}

/** Os quatro grupos da prévia, só os que têm ocorrências. `change` é "De X para Y" do valor novo. */
export function previewRows(
  groups: PreviewGroups,
  mode: PreviewMode,
  change = "",
): PreviewRow[] {
  const order: GroupName[] = ["replaced", "preserved", "cancelled", "edited"];
  return order
    .filter((g) => groups[g].length > 0)
    .map((group) => ({
      group,
      tone: TONES[group],
      count: groups[group].length,
      title: rowTitle(group, mode, groups[group].length),
      detail: rowDetail(group, groups[group], mode === "next" && change ? ` ${change}` : ""),
    }));
}

export function decisionLabels(mode: PreviewMode): Record<Choice, string> {
  return mode === "end"
    ? { keep: "Manter no plano", replace: "Remover do plano" }
    : { keep: "Manter meu ajuste", replace: "Usar o novo valor" };
}

export function pendingCount(groups: PreviewGroups, decisions: Decisions): number {
  return groups.edited.filter((e) => !decisions[e.monthly_item_id]).length;
}

/** Confirmar só com todas as ajustadas à mão decididas. */
export function canConfirm(groups: PreviewGroups, decisions: Decisions): boolean {
  return pendingCount(groups, decisions) === 0;
}

export function pendingText(groups: PreviewGroups, decisions: Decisions): string {
  const n = pendingCount(groups, decisions);
  if (n > 0)
    return `Falta decidir ${n} ${plural(n, "conta ajustada", "contas ajustadas")} para confirmar.`;
  return groups.edited.length ? "Tudo decidido. Pode confirmar." : "Pode confirmar.";
}

/** Versão de cada item que a prévia viu; o servidor recusa se alguma mudou depois. */
export function versionsOf(groups: PreviewGroups): Record<string, number> {
  const seen: Record<string, number> = {};
  for (const e of [...groups.replaced, ...groups.edited, ...groups.preserved])
    seen[e.monthly_item_id] = e.version;
  return seen;
}

function decisionsOf(groups: PreviewGroups, decisions: Decisions): Decisions {
  const chosen: Decisions = {};
  for (const e of groups.edited) {
    const choice = decisions[e.monthly_item_id];
    if (choice) chosen[e.monthly_item_id] = choice;
  }
  return chosen;
}

export function applyBody(
  preview: Preview,
  change: number | Record<string, unknown>,
  decisions: Decisions,
) {
  return {
    recurrence_id: preview.recurrence_id,
    from: preview.from,
    changes: typeof change === "number" ? { expected_cents: change } : change,
    decisions: decisionsOf(preview.groups, decisions),
    versions: versionsOf(preview.groups),
  };
}

export function endBody(preview: Preview, decisions: Decisions) {
  return {
    recurrence_id: preview.recurrence_id,
    from: preview.from,
    decisions: decisionsOf(preview.groups, decisions),
    versions: versionsOf(preview.groups),
  };
}

/** Valor novo digitado: bloqueia o envio em vez de virar vazio ou zero em silêncio. */
export function newAmount(text: string): NewAmount {
  const error = { error: "Digite o novo valor, por exemplo 640,00." };
  if (!text.trim()) return error;
  try {
    const n = cents(text);
    return n > 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? { cents: Number(n) } : error;
  } catch {
    return error;
  }
}

/** O servidor recusa com "Veja a prévia de novo" quando algum item mudou depois da prévia. */
export function isStale(message: string): boolean {
  return /prévia de novo/i.test(message);
}

/** "De R$ 612,00 para R$ 640,00", ou nada enquanto o valor novo não é válido. */
export function changeText(
  planned: string | null,
  amount: NewAmount,
  currency: string,
  hidden: boolean,
): string {
  if (planned === null || "error" in amount) return "";
  return `De ${money(planned, currency, hidden)} para ${money(String(amount.cents), currency, hidden)}.`;
}
