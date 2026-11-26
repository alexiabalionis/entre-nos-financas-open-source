"use client";
import { Button } from "../../button";
import { Callout } from "../../ds/callout";
import { reviewSummary } from "./overview-copy.ts";

/** Aviso de que a data da fatura do cartão mudou; quem pode editar abre a lista para revisar. */
export function ReviewNotice({
  count,
  onReview,
}: {
  count: number;
  /** Ausente para quem só acompanha. */
  onReview: (() => void) | null;
}) {
  return (
    <Callout
      tone="warn"
      icon="!"
      title="A data da fatura do cartão mudou"
      details={
        onReview && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={onReview}>
              Revisar
            </Button>
          </div>
        )
      }
    >
      {reviewSummary(count)}
    </Callout>
  );
}
