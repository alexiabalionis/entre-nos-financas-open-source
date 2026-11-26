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
  danger: "text-error",
  warn: "text-warning",
  ok: "text-success",
};

/** Verdict com cor do tom (daisy). */
export function verdictClass(tone: string): string {
  return "text-sm font-medium " + (VERDICT_TONE[tone] ?? "");
}

/** Números lado a lado (daisy stats): rótulo + valor. */
export function BudgetNums({ items }: { items: [string, string][] }) {
  return (
    <dl className="stats w-full">
      {items.map(([label, value]) => (
        <div className="stat px-3 py-2 first:pl-0" key={label}>
          <dt className="stat-title whitespace-normal">{label}</dt>
          <dd className="stat-value text-lg tabular-nums [font-family:var(--family-font-numeric)]">
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
