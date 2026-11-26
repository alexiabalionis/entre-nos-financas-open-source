"use client";
// Um cartão por objetivo: só o essencial (nome, saldo, quanto falta, status)
// fica sempre visível. O resto — ritmo, números do mês, histórico e ações —
// fica atrás do toque, via o `expand` do StatBanner. As ações (que têm seus
// próprios <button>) vão no `expand.content`, fora do <button> do gatilho.
import { useState, type CSSProperties } from "react";
import { StatBanner } from "../ds/stat-banner.tsx";
import { StatusChip } from "../ds/status-chip.tsx";
import { IconBadge } from "../ds/icon-badge.tsx";
import { RowList } from "../ds/row-list.tsx";
import { Button } from "../button.tsx";
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
  write,
  onEdit,
}: {
  goal: Goal;
  /** Posição na lista: escolhe a cor do badge (mesma paleta do TotalPanel). */
  index: number;
  today: string;
  money: Money;
  reader: boolean;
  write: (w: CopilotWrite) => Promise<void>;
  onEdit: (goal: Goal) => void;
}) {
  const [message, setMessage] = useState("");
  const status = chip(goal);
  const note = goal.movements.length ? insight(goal, today, money) : "";
  const verdict = pace(goal, today);
  const recent = goal.movements.slice(0, 2);
  const tone = GOAL_COLORS[index % GOAL_COLORS.length];
  return (
    <StatBanner
      eyebrow={
        <span className="goal-eyebrow">
          <IconBadge
            icon={initial(goal)}
            size="sm"
            data-cat=""
            style={{ "--tone": tone } as CSSProperties}
          />
          {goal.name}
        </span>
      }
      value={money(saved(goal))}
      caption={caption(goal, money)}
      trailing={<StatusChip tone={status.tone} label={status.label} />}
      rail={railPct(goal)}
      railTone={reached(goal) ? "ok" : "accent"}
      expand={{
        label: "Ver detalhes e opções",
        content: (
          <>
            {verdict && (
              <StatusChip tone={verdict.tone} label={verdict.label} ghost />
            )}
            <div className="goal-nums">
              <span>
                Meta
                <b>{money(target(goal))}</b>
              </span>
              <span>
                Este mês
                <b>{monthProgressText(goal, today, money)}</b>
              </span>
              <span>
                Faltam
                <b>{reached(goal) ? "Concluído" : money(remaining(goal))}</b>
              </span>
            </div>
            {message && (
              <p className="ds-caption alert alert-soft alert-info" role="status">
                {message}
              </p>
            )}
            {note && (
              <p className="ds-caption">
                <b>{note}</b>
              </p>
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
                  write={write}
                  onDone={setMessage}
                />
              ))}
            {!reader && (
              <div className="cop-links">
                <Button variant="text" onClick={() => onEdit(goal)}>
                  Editar
                </Button>
              </div>
            )}
          </>
        ),
      }}
    />
  );
}
