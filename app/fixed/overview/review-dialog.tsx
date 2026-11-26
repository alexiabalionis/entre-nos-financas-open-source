"use client";
import { useState } from "react";
import { Button } from "../../button";
import { Callout } from "../../ds/callout";
import { FamilyDialog } from "../../dialogs/family-dialog";
import { Row } from "../../ds/row";
import { StatusChip } from "../../ds/status-chip";
import { useAction } from "../../hooks/use-action.ts";
import { api } from "../../lib/api.ts";
import { movedNotice } from "../fixed-move-model.ts";
import { reviewButton, reviewDetail } from "./overview-copy.ts";
import { reviewRequest } from "./overview-requests.ts";
import type { OverviewReview } from "./overview-types.ts";

/**
 * Cada previsão só muda de mês quando a pessoa confirma aquela linha. A lista
 * fica como estava ao abrir, para a linha confirmada mostrar "Movida" no lugar.
 */
export function ReviewDialog({
  items,
  onMoved,
  onClose,
}: {
  items: OverviewReview[];
  onMoved: (message: string) => void;
  onClose: () => void;
}) {
  const action = useAction();
  const [list] = useState(items);
  const [moved, setMoved] = useState<ReadonlySet<string>>(new Set());
  const finished = moved.size === list.length;

  const move = (review: OverviewReview) => {
    const request = reviewRequest(review);
    void action.work(async () => {
      await api(request.route, request.body);
      setMoved((prev) => new Set(prev).add(review.item_id));
      onMoved(movedNotice(review.label, review.suggested_month));
    }, "");
  };

  return (
    <FamilyDialog
      open
      title="Revisar previsões do cartão"
      busy={action.busy}
      error={action.error}
      onClose={onClose}
    >
      {finished && (
        <Callout tone="ok" icon="✓" title="Previsões atualizadas">
          As previsões foram para o mês certo.
        </Callout>
      )}
      <div className="ds-list list gap-0">
        {list.map((review) => (
          <Row
            key={review.item_id}
            bordered
            title={review.label}
            sub={reviewDetail(review)}
          >
            {moved.has(review.item_id) ? (
              <StatusChip tone="ok" icon="✓" label="Movida" />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  disabled={action.busy}
                  onClick={() => move(review)}
                >
                  {reviewButton(review)}
                </Button>
              </div>
            )}
          </Row>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="quiet" disabled={action.busy} onClick={onClose}>
          {finished ? "Fechar" : "Agora não"}
        </Button>
      </div>
    </FamilyDialog>
  );
}
