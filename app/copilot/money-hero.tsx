"use client";
// Topo do Copiloto: quanto está livre até a véspera do próximo salário, com o
// "Como chegamos nesse valor" recolhido.
import { StatBanner } from "../ds/stat-banner.tsx";
import { StatusChip } from "../ds/status-chip.tsx";
import { RowList } from "../ds/row-list.tsx";
import type { CopilotWire } from "../../src/server/copilot.ts";
import { ddmm } from "../month/format.ts";
import { breakdownRows, heroView } from "./hero.ts";
import { paceText } from "./pace.ts";
import type { Money } from "./money.ts";

export function MoneyHero({ copilot, money }: { copilot: CopilotWire; money: Money }) {
  const v = heroView(copilot, money);
  const rhythm = paceText(copilot, money);
  return (
    <StatBanner
      inverted
      eyebrow={v.eyebrow}
      value={v.value}
      title={v.title}
      caption={v.caption}
      trailing={<StatusChip tone={v.chip.tone} label={v.chip.label} />}
      expand={
        v.expandable
          ? {
              label: "Como chegamos nesse valor",
              content: (
                <>
                  <div className="ds-stat-expand-h">
                    <span>Como chegamos nesse valor</span>
                    <span className="ds-panel-meta">
                      dia mais apertado: {ddmm(copilot.breakdown.lowDay)}
                    </span>
                  </div>
                  <RowList rows={breakdownRows(copilot, money)} bordered={false} />
                </>
              ),
            }
          : undefined
      }
    >
      {rhythm && <p className="ds-caption">{rhythm}</p>}
    </StatBanner>
  );
}
