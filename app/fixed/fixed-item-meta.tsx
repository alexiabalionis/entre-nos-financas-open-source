"use client";
import { StatusChip } from "../ds/status-chip";
import {
  amountDifference,
  fixedState,
  stateBadge,
  type StatusItem,
} from "./fixed-status.ts";

/** Selo "Fixa", estado e, quando pago por outro valor, a diferença, sob a linha da conta. */
export function FixedItemMeta({
  item,
  hidden,
}: {
  item: StatusItem;
  hidden: boolean;
}) {
  const badge = stateBadge(fixedState(item));
  const difference = amountDifference(item, hidden);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusChip tone="accent" ghost icon="↻" label="Fixa" />
      <StatusChip tone={badge.tone} label={badge.label} />
      {difference && (
        <>
          <span className="text-xs opacity-60">{difference.detail}</span>
          <StatusChip tone={difference.tone} icon="▲" label={difference.chip} />
        </>
      )}
    </div>
  );
}
