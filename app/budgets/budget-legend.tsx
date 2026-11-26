"use client";

const ITEMS = [
  ["is-spent", "Já gastou"],
  ["is-planned", "Ainda vai pagar"],
  ["is-free", "Sobra no teto"],
  ["is-over", "Acima do teto"],
] as const;

export function BudgetLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs opacity-70" aria-label="Como ler as barras">
      {ITEMS.map(([kind, label]) => (
        <li key={kind} className="flex items-center gap-1.5">
          <span className={"budget-sw " + kind} />
          {label}
        </li>
      ))}
    </ul>
  );
}
