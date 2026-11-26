"use client";
import { Button } from "../button";
import { referenceView } from "./budget-reference-model.ts";
import { useBudgetReference } from "./use-budget-reference.ts";
import type { Money } from "./budget-view-model.ts";

/** Referência do gasto da categoria + "Usar R$ X", que só preenche o campo. */
export function BudgetReference({
  categoryId,
  month,
  fmt,
  hidden,
  onUse,
}: {
  categoryId: string;
  month: string;
  fmt: Money;
  hidden: boolean;
  onUse: (cents: bigint) => void;
}) {
  const { loading, ref } = useBudgetReference(categoryId, month);
  if (loading) return null;
  const view = referenceView(ref, fmt);
  const { suggestion } = view;
  return (
    <div className="flex flex-col items-start gap-2" role="status">
      <p className="ds-caption">{view.text}</p>
      {suggestion !== null && !hidden && (
        <Button variant="quiet" onClick={() => onUse(suggestion)}>
          Usar {fmt(suggestion)}
        </Button>
      )}
    </div>
  );
}
