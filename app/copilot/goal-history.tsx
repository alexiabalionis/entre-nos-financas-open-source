"use client";
import { Disclosure } from "../ds/disclosure.tsx";
import { RowList } from "../ds/row-list.tsx";
import { monthLabel } from "../month/format.ts";
import { history, movementRow, type Goal } from "./model.ts";
import { signedMoney, type Money } from "./money.ts";

export function GoalHistory({ goal, money }: { goal: Goal; money: Money }) {
  if (!goal.movements.length) return null;
  return (
    <Disclosure summary="Ver todo o histórico">
      <div className="flex flex-col gap-3">
        {history(goal).map((group) => (
          <div key={group.month}>
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-ink">
              <span>{monthLabel(group.month)}</span>
              <span className="font-numeric tabular-nums text-muted">
                {signedMoney(money, group.total)} no mês
              </span>
            </div>
            <RowList
              bordered={false}
              rows={group.rows.map((m) => movementRow(m, money))}
            />
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
