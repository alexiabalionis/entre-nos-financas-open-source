"use client";
import { useState } from "react";
import { InsightsScreen } from "./insights-screen.tsx";
import { PeriodLoading } from "../shell/period-loading";
import { PeriodDialog } from "../dialogs/period-dialog";
import { MonthHeader } from "../month/blocks/month-header.tsx";
import { monthTitle, moveMonth } from "../lib/dates.ts";
import { useSession } from "../session/session-context";
import { usePeriodData } from "../hooks/use-period-data.ts";
import { monthCategories } from "../month/screen-input.ts";

/**
 * Página /panorama: segue o mês da URL (como Mês e Movimentos). Mês passado
 * mostra como tudo estava no fim dele; as categorias do mês colorem os gráficos.
 */
export function InsightsPage() {
  const session = useSession();
  const period = usePeriodData();
  const [picking, setPicking] = useState(false);
  const { month } = period;
  // Ao trocar de mês, as categorias do mês novo chegam depois: o Panorama fica
  // na tela com as do mês anterior (só colorem os gráficos) em vez de voltar
  // para "Carregando" e perder a aba e as transições.
  const fresh = period.data?.state.categories;
  const [kept, setKept] = useState<{ source: typeof fresh; list: ReturnType<typeof monthCategories> } | null>(null);
  if (fresh && kept?.source !== fresh) setKept({ source: fresh, list: monthCategories(fresh) });
  const categories = fresh && kept?.source !== fresh ? monthCategories(fresh) : (kept?.list ?? null);
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
          onLabelClick={() => setPicking(true)}
        />
      </div>
      {categories ? (
        <InsightsScreen month={month} hidden={session.hidden} categories={categories} />
      ) : (
        <PeriodLoading error={period.error} onRetry={period.reload} />
      )}
      <PeriodDialog
        open={picking}
        month={month}
        setMonth={period.setMonth}
        onClose={() => setPicking(false)}
      />
    </>
  );
}
