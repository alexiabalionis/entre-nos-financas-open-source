"use client";
import { useState } from "react";
import { maskMoney } from "../lib/cents.ts";
import { AccordionGroup, Button } from "../ds/index.ts";
import { FlatPanelsProvider, Panel } from "../ds/panel.tsx";
import { RowList } from "../ds/row-list.tsx";
import { CardBillChart } from "./card-bill-chart.tsx";
import { FutureProvider, useFutureContext } from "./future-context.tsx";
import { FutureDraftBar } from "./future-draft-bar.tsx";
import { GoalLanes } from "./goal-lanes.tsx";
import { Headline } from "./headline.tsx";
import { MonthStations } from "./month-stations.tsx";
import { Premises } from "./premises.tsx";
import { ReservesSection } from "./reserves-section.tsx";
import { Simulator } from "./simulator.tsx";
import { useFuture } from "./use-future.ts";

export type FutureMode = "ver" | "simular";

/**
 * Tela do Futuro em dois modos que dividem o mesmo rascunho: "ver" (horizonte,
 * trilhos, mês a mês, fatura, reservas/metas e próximo passo) e "simular"
 * (split 2 colunas no desktop, bottom sheet no celular).
 */
export function FutureScreen({
  hidden,
  reader,
  mode = "ver",
  onMode,
}: {
  hidden: boolean;
  reader: boolean;
  mode?: FutureMode;
  onMode?: (m: FutureMode) => void;
}) {
  const store = useFuture();
  return (
    <FutureProvider value={store} hidden={hidden} reader={reader}>
      <FutureBody reload={store.reload} mode={mode} onMode={onMode} />
    </FutureProvider>
  );
}

function FutureBody({
  reload,
  mode,
  onMode,
}: {
  reload: () => Promise<void>;
  mode: FutureMode;
  onMode?: (m: FutureMode) => void;
}) {
  const f = useFutureContext();
  const [reservesSyncKey, setReservesSyncKey] = useState(0);
  const bumpReserves = () => setReservesSyncKey((k) => k + 1);

  if (f.status === "error")
    return (
      <div className="fut-screen flex flex-col gap-5">
        <Headline />
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
        >
          <span>Não deu para montar o futuro agora.</span>
          <Button variant="quiet" size="sm" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </div>
      </div>
    );
  if (!f.input)
    return (
      <div className="fut-screen flex flex-col gap-5" aria-busy="true">
        <Headline />
      </div>
    );
  if (mode === "simular")
    return (
      <div className="fut-screen flex flex-col gap-5">
        <Simulator onCommitted={bumpReserves} />
      </div>
    );
  return (
    <div className="fut-screen flex flex-col gap-6">
      <Headline />
      {onMode ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="primary"
            size="sm"
            icon="spark"
            onClick={() => onMode("simular")}
          >
            Simular compra ou meta
          </Button>
        </div>
      ) : null}
      <NextStep />
      <ReservesSection
        hidden={f.hidden}
        reader={f.reader}
        syncKey={reservesSyncKey}
        onMutated={() => void reload()}
        showTotalPanel={false}
        collapseMargin
      />
      <AccordionGroup
        variant="card"
        defaultOpen={false}
        title="Ver projeção detalhada"
        subtitle="Trilhos no tempo, conta mês a mês, fatura futura e premissas"
        contentClassName="flex flex-col gap-5 pt-4"
      >
        <FlatPanelsProvider>
          <GoalLanes />
          <MonthStations />
          <CardBillChart />
          <Premises />
        </FlatPanelsProvider>
      </AccordionGroup>
      <FutureDraftBar onSaved={bumpReserves} />
    </div>
  );
}

function NextStep() {
  const f = useFutureContext();
  const first = f.draft?.decisions[0];
  if (!first) return null;
  return (
    <Panel title="Próximo passo" className="mb-0">
      <RowList
        bordered={false}
        rows={[
          {
            title: maskMoney(first.title, f.hidden),
            sub: maskMoney(first.impact, f.hidden),
          },
        ]}
      />
    </Panel>
  );
}
