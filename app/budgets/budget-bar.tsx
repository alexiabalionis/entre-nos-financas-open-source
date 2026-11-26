"use client";
import { SegmentedBar } from "../ds/segmented-bar";
import {
  barAria,
  barSegments,
  type BudgetCardModel,
  type Money,
} from "./budget-view-model.ts";

export function BudgetBar({ card, fmt }: { card: BudgetCardModel; fmt: Money }) {
  return (
    <div className="w-full">
      <SegmentedBar segments={barSegments(card)} aria={barAria(card, fmt)} />
    </div>
  );
}
