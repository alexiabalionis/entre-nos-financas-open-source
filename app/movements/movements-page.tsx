"use client";
import { useState } from "react";
import { MovementsPanel } from "../family-movements";
import { PeriodDialog } from "../dialogs/period-dialog";
import { MonthHeader } from "../month/blocks/month-header.tsx";
import { monthTitle, moveMonth } from "../lib/dates.ts";
import { RecordMovementDialog } from "../dialogs/record-movement-dialog";
import { ActionBanner } from "../shell/action-banner";
import { PeriodLoading } from "../shell/period-loading";
import { useSession } from "../session/session-context";
import { useAction } from "../hooks/use-action.ts";
import { usePeriodData } from "../hooks/use-period-data.ts";

/** Página /movimentos: histórico do mês e registro de novos movimentos. */
export function MovementsPage() {
  const session = useSession();
  const period = usePeriodData();
  const action = useAction();
  const [modal, setModal] = useState<"period" | "movement" | null>(null);
  const { month, currency, data } = period;
  return (
    <>
      <div className="mb-3">
        <MonthHeader
          label={monthTitle(month)}
          prevLabel="Mês anterior"
          nextLabel="Próximo mês"
          labelAriaLabel={`Escolher mês: ${monthTitle(month)}`}
          onPrev={() => period.setMonth(moveMonth(month, -1))}
          onNext={() => period.setMonth(moveMonth(month, 1))}
          onLabelClick={() => setModal("period")}
        />
      </div>
      {data ? (
        <>
          <ActionBanner
            error={action.error || period.error}
            notice={action.notice}
          />
          <MovementsPanel
            key={month}
            state={data.state}
            currency={currency}
            hidden={session.hidden}
            reader={session.reader}
            onRecord={() => {
              action.setError("");
              setModal("movement");
            }}
            refresh={period.reload}
          />
        </>
      ) : (
        <>
          <ActionBanner error={action.error} notice={action.notice} />
          <PeriodLoading error={period.error} onRetry={period.reload} />
        </>
      )}
      <PeriodDialog
        open={modal === "period"}
        month={month}
        setMonth={period.setMonth}
        onClose={() => setModal(null)}
      />
      <RecordMovementDialog
        open={modal === "movement"}
        initialKind="expense"
        month={month}
        action={action}
        onClose={() => setModal(null)}
        onSaved={period.reload}
      />
    </>
  );
}
