"use client";
import { useState, type CSSProperties } from "react";
import { StatBanner } from "../ds/stat-banner.tsx";
import { StatusChip } from "../ds/status-chip.tsx";
import { IconBadge } from "../ds/icon-badge.tsx";
import { RowList } from "../ds/row-list.tsx";
import { Button } from "../ds/button.tsx";
import {
  caption,
  chip,
  initial,
  insight,
  monthProgressText,
  movementRow,
  pace,
  railPct,
  reached,
  remaining,
  saved,
  target,
  type Goal,
} from "./model.ts";
import { GOAL_COLORS, type Money } from "./money.ts";
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { CopilotWrite } from "../hooks/use-copilot.ts";
import { GoalHistory } from "./goal-history.tsx";
import { GoalActions } from "./goal-actions.tsx";
import { GoalLocation } from "./goal-location.tsx";

export function GoalCard({
  goal,
  index,
  today,
  money,
  reader,
  copilot,
  write,
  onEdit,
}: {
  goal: Goal;
  index: number;
  today: string;
  money: Money;
  reader: boolean;
  copilot?: CopilotWire;
  write: (w: CopilotWrite) => Promise<void>;
  onEdit: (goal: Goal) => void;
}) {
  const [message, setMessage] = useState("");
  const status = chip(goal);
  const done = reached(goal);
  const note = goal.movements.length ? insight(goal, today, money) : "";
  const verdict = pace(goal, today);
  const recent = goal.movements.slice(0, 2);
  const tone = GOAL_COLORS[index % GOAL_COLORS.length];
  const primaryPlan = copilot?.goal?.id === goal.id ? copilot.goal.plan : null;

  return (
    <StatBanner
      className={done ? "border-ok/35 bg-ok-bg/25" : undefined}
      eyebrow={
        <span className="inline-flex items-center gap-2 font-semibold text-ink">
          <IconBadge
            icon={initial(goal)}
            size="sm"
            data-cat=""
            style={{ "--tone": tone } as CSSProperties}
          />
          <span className="truncate">{goal.name}</span>
        </span>
      }
      value={money(saved(goal))}
      caption={caption(goal, money)}
      trailing={
        <StatusChip
          tone={done ? "ok" : status.tone}
          icon={done ? "✓" : undefined}
          label={status.label}
        />
      }
      rail={railPct(goal)}
      railTone={done ? "ok" : "accent"}
      expand={{
        label: "Ver detalhes e opções",
        content: (
          <div className="flex flex-col gap-3">
            {verdict && (
              <div>
                <StatusChip tone={verdict.tone} label={verdict.label} ghost />
              </div>
            )}
            <dl className="m-0 grid grid-cols-3 gap-2 rounded-xl border border-border bg-surface p-3 text-xs">
              <div className="min-w-0">
                <dt className="text-muted">Meta</dt>
                <dd className="m-0 mt-0.5 font-numeric text-sm font-semibold tabular-nums text-ink">
                  {money(target(goal))}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">Este mês</dt>
                <dd className="m-0 mt-0.5 font-numeric text-sm font-semibold tabular-nums text-ink">
                  {monthProgressText(goal, today, money)}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="text-muted">Faltam</dt>
                <dd className="m-0 mt-0.5 font-numeric text-sm font-semibold tabular-nums text-ink">
                  {done ? "Concluído" : money(remaining(goal))}
                </dd>
              </div>
            </dl>
            {message && (
              <p
                className="m-0 rounded-xl border border-info/25 bg-info-bg px-3 py-2 text-xs font-medium text-ink"
                role="status"
              >
                {message}
              </p>
            )}
            {note && (
              <p className="ds-caption m-0 font-medium text-ink">{note}</p>
            )}
            {recent.length > 0 && (
              <RowList
                bordered={false}
                rows={recent.map((m) => movementRow(m, money))}
              />
            )}
            <GoalHistory goal={goal} money={money} />
            {!reader &&
              (goal.location === null ? (
                <GoalLocation goal={goal} write={write} />
              ) : (
                <GoalActions
                  goal={goal}
                  money={money}
                  primaryPlan={primaryPlan}
                  write={write}
                  onDone={setMessage}
                />
              ))}
            {!reader && (
              <div className="border-t border-border pt-2">
                <Button variant="quiet" size="sm" icon="edit" onClick={() => onEdit(goal)}>
                  Editar meta e prazo
                </Button>
              </div>
            )}
          </div>
        ),
      }}
    />
  );
}
