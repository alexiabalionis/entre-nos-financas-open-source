"use client";
import { Icon } from "../ds/index.ts";
import { Collapsible } from "../collapsible.tsx";
import { maskMoney } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";

export function Premises() {
  const f = useFutureContext();
  const list = (f.draft ?? f.base)?.premises ?? [];
  return (
    <Collapsible
      variant="card"
      summary={
        <span className="inline-flex items-center gap-2">
          <Icon name="info" size={16} className="text-muted" />
          <span>Premissas desta projeção</span>
        </span>
      }
    >
      <ul className="m-0 list-disc space-y-1.5 pl-5 text-sm text-muted">
        {list.length === 0 ? (
          <li>Nenhuma premissa adicional além do plano salvo.</li>
        ) : null}
        {list.map((p) => (
          <li key={p}>{maskMoney(p, f.hidden)}</li>
        ))}
      </ul>
    </Collapsible>
  );
}
