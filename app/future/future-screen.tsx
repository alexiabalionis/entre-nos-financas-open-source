"use client";
import { useState } from "react";
import { maskMoney } from "../lib/cents.ts";
import { Button } from "../ds/index.ts";
import { Panel } from "../ds/panel.tsx";
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
      <GoalLanes />
      <MonthStations />
      <CardBillChart />
      <ReservesSection
        hidden={f.hidden}
        reader={f.reader}
        syncKey={reservesSyncKey}
        onMutated={() => void reload()}
      />
      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <NextStep onSimulate={onMode ? () => onMode("simular") : undefined} />
        <Premises />
      </div>
      <FutureDraftBar onSaved={bumpReserves} />
    </div>
  );
}

function NextStep({ onSimulate }: { onSimulate?: () => void }) {
  const f = useFutureContext();
  const first = f.draft?.decisions[0];
  return (
    <Panel title="Próximo passo" className="mb-0">
      {first ? (
        <RowList
          bordered={false}
          rows={[
            {
              title: maskMoney(first.title, f.hidden),
              sub: maskMoney(first.impact, f.hidden),
            },
          ]}
        />
      ) : (
        <p className="ds-caption">Nada pede atenção neste horizonte.</p>
      )}
      {onSimulate ? (
        <div>
          <Button variant="quiet" size="sm" onClick={onSimulate}>
            Simular mudanças
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}
