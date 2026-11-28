"use client";
import { BudgetBar } from "./budget-bar";
import {
  STATE_VIEW,
  verdictText,
  type BudgetCardModel,
  type Money,
} from "./budget-view-model.ts";

/** O teto de uma categoria: barra, números e frase de veredito. */
const VERDICT_TONE: Record<string, string> = {
  danger: "text-danger",
  warn: "text-warn",
  ok: "text-ok",
};

/** Verdict com cor do tom semântico do DS. */
export function verdictClass(tone: string): string {
  return "text-sm font-medium " + (VERDICT_TONE[tone] ?? "");
}

/** Números lado a lado: rótulo + valor. */
export function BudgetNums({ items }: { items: [string, string][] }) {
  return (
    <dl className="m-0 grid grid-cols-3 gap-2 rounded-xl bg-surface-2/60 p-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="m-0 mt-0.5 font-numeric text-base font-semibold text-ink tabular-nums">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function BudgetSummary({
  card,
  fmt,
}: {
  card: BudgetCardModel;
  fmt: Money;
}) {
  const view = STATE_VIEW[card.state];
  return (
    <>
      <BudgetBar card={card} fmt={fmt} />
      <BudgetNums
        items={[
          ["Teto", fmt(card.ceiling)],
          ["Já gastou", fmt(card.spent)],
          ["Ainda vai pagar", fmt(card.open)],
        ]}
      />
      <p className={verdictClass(view.tone)} data-tone={view.tone}>
        {verdictText(card, fmt)}
      </p>
    </>
  );
}
