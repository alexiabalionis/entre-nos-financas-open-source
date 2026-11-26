"use client";
import { StatusChip } from "../../ds/status-chip";
import type { Chip } from "./overview-types.ts";

/** Etiquetas de situação sob o título de uma linha. */
export function OverviewChips({ chips }: { chips: Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <StatusChip
          key={chip.label}
          tone={chip.tone}
          icon={chip.icon}
          label={chip.label}
        />
      ))}
    </div>
  );
}
