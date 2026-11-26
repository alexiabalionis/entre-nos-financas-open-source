"use client";
import { StatBanner } from "../../ds/stat-banner";
import { money } from "../../lib/money.ts";
import { summary } from "./overview-model.ts";
import type { Overview } from "./overview-types.ts";

/** Total do mês e quantas contas fixas estão ativas. */
export function OverviewSummary({
  overview,
  month,
  hidden,
}: {
  overview: Overview;
  month: string;
  hidden: boolean;
}) {
  const model = summary(overview, month);
  return (
    <StatBanner
      eyebrow={model.eyebrow}
      value={money(model.totalCents, "BRL", hidden)}
      caption={model.caption}
    />
  );
}
