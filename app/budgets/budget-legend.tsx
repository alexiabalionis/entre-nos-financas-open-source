"use client";

const ITEMS = [
  ["bg-accent", "Já gastou"],
  ["border border-accent/30 bg-accent-soft", "Ainda vai pagar"],
  ["border border-border-strong bg-surface", "Sobra no teto"],
  ["bg-danger", "Acima do teto"],
] as const;

export function BudgetLegend() {
  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-muted"
      aria-label="Como ler as barras"
    >
      {ITEMS.map(([swatch, label]) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            className={`size-2.5 shrink-0 rounded-[3px] ${swatch}`}
            aria-hidden="true"
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
