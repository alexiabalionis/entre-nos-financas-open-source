"use client";
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
import { Simulator } from "./simulator.tsx";
import { useFuture } from "./use-future.ts";

export type FutureMode = "ver" | "simular";

/**
 * Tela do Futuro em dois modos que dividem o mesmo rascunho: "ver" (desenho
 * A+B: destaque, trilhos, mês a mês, fatura e o próximo passo) e "simular"
 * (uma mudança por vez com o efeito ao lado). Busca os próprios dados; quem a
 * usa passa a sessão e o modo. A fonte vem do FutureScope de quem monta a página.
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
  if (f.status === "error")
    return (
      <div className="fut-screen">
        <Headline />
        <p role="alert" className="ds-caption alert alert-soft alert-error">
          Não deu para montar o futuro agora.{" "}
          <Button variant="text" onClick={() => void reload()}>
            Tentar novamente
          </Button>
        </p>
      </div>
    );
  if (!f.input)
    return (
      <div className="fut-screen" aria-busy="true">
        <Headline />
      </div>
    );
  if (mode === "simular")
    return (
      <div className="fut-screen">
        {/* Aqui o painel "O que muda" já compara, salva e descarta: sem barra. */}
        <Simulator />
      </div>
    );
  return (
    <div className="fut-screen">
      <Headline />
      <GoalLanes />
      <MonthStations />
      <CardBillChart />
      <NextStep onSimulate={onMode ? () => onMode("simular") : undefined} />
      <Premises />
      <FutureDraftBar />
    </div>
  );
}

/** O primeiro passo que o motor sugere, em uma frase, e a porta para o simulador. */
function NextStep({ onSimulate }: { onSimulate?: () => void }) {
  const f = useFutureContext();
  const first = f.draft?.decisions[0];
  return (
    <Panel title="Próximo passo">
      {first ? (
        <RowList
          bordered={false}
          rows={[{ title: maskMoney(first.title, f.hidden), sub: maskMoney(first.impact, f.hidden) }]}
        />
      ) : (
        <p className="ds-caption">Nada pede atenção neste horizonte.</p>
      )}
      {onSimulate ? (
        <div>
          <Button onClick={onSimulate}>Simular mudanças</Button>
        </div>
      ) : null}
    </Panel>
  );
}
