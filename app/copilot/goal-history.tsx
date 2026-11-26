"use client";
// Movimentos do objetivo agrupados por mês, dentro de uma Disclosure.
import { Disclosure } from "../ds/disclosure.tsx";
import { RowList } from "../ds/row-list.tsx";
import { monthLabel } from "../month/format.ts";
import { history, movementRow, type Goal } from "./model.ts";
import { signedMoney, type Money } from "./money.ts";

export function GoalHistory({ goal, money }: { goal: Goal; money: Money }) {
  if (!goal.movements.length) return null;
  return (
    <Disclosure summary="Ver todo o histórico">
      {history(goal).map((group) => (
        <div key={group.month}>
          <div className="ds-stat-expand-h">
            <span>{monthLabel(group.month)}</span>
            <span className="ds-panel-meta">
              {signedMoney(money, group.total)} no mês
            </span>
          </div>
          <RowList
            bordered={false}
            rows={group.rows.map((m) => movementRow(m, money))}
          />
        </div>
      ))}
    </Disclosure>
  );
}
