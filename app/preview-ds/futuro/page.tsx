"use client";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import {
  AmountStepper,
  AnimatedMoney,
  CalcList,
  ChangedText,
  DiffList,
  DraftBar,
  Icon,
  IconButton,
  LaneTracks,
  MonthRail,
  Segmented,
  Sheet,
  StackedBars,
  type BarLayer,
  type CalcLine,
  type DiffRow,
  type IconName,
  type Lane,
  type RailItem,
} from "../../ds/index.ts";
import {
  briefingInput,
  emptyInput,
  FutureProvider,
  FutureScope,
  futureReducer,
  CardBillChart,
  ContributionControl,
  DecisionList,
  EverydayControl,
  FutureDraftBar,
  GoalLanes,
  Headline,
  HorizonSwitch,
  MonthStations,
  Premises,
  PurchaseSimulator,
  initialState,
  planWrites,
  useFutureContext,
  type FutureStore,
} from "../../future/index.ts";
import type { FutureInput } from "../../../src/domain/future-months.ts";
import { formatReais, formatSignedReais } from "../../lib/cents.ts";
import css from "./showcase.module.css";

/**
 * Vitrine do Futuro: cada peça da camada 1 com dados fixos e controles para
 * ver os movimentos; as da camada 2 vivem num FutureProvider sem rede.
 */

type Fixture = "briefing" | "dia a dia" | "vazio";

/** Imita useFuture sem rede: o mesmo tipo de retorno, alimentado pela fixture. */
function useFixtureFuture(input: FutureInput): FutureStore {
  const [state, dispatch] = useReducer(futureReducer, undefined, () =>
    futureReducer(initialState(24), { type: "loaded", input }),
  );
  const save = useCallback(async () => {
    if (!state.input) return false;
    console.info("[vitrine] save()", planWrites(state.input, state.scenario));
    dispatch({ type: "discard" });
    return true;
  }, [state.input, state.scenario]);
  const reload = useCallback(async () => {}, []);
  return { state, dispatch, status: "ready", error: "", saving: false, reload, save };
}

/** "dia a dia" = briefing com média declarada, para mostrar o EverydayControl ativo. */
function inputFor(fixture: Fixture): FutureInput {
  if (fixture === "vazio") return emptyInput();
  const base = briefingInput();
  return fixture === "dia a dia" ? { ...base, everyday: { weekly: 35000n, source: "declarado" } } : base;
}

// ---------- camada 1: dados de exemplo ----------

const MONTH_NAMES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const FULL_NAMES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
/** Mês 0 da vitrine = dezembro de 2026. */
const at = (i: number) => {
  const t = 2026 * 12 + 11 + i;
  return { y: Math.floor(t / 12), m: t % 12 };
};
const shortLabel = (i: number) => `${MONTH_NAMES[at(i).m]}/${String(at(i).y).slice(2)}`;
const longLabel = (i: number) => `${FULL_NAMES[at(i).m]} de ${at(i).y}`;

const ICONS: IconName[] = [
  "plus", "minus", "check", "close", "left", "right", "up", "down", "undo",
  "flag", "info", "pause", "play", "alert", "spark", "layers", "calendar", "card",
];

const LAYERS: BarLayer[] = [
  { key: "rec", label: "Recorrentes", color: "var(--family-cat-cards)" },
  { key: "dia", label: "Dia a dia (média)", color: "var(--family-cat-none)", estimate: true },
  { key: "gel", label: "Geladeira", color: "var(--family-cat-1)" },
  { key: "oc", label: "Óculos", color: "var(--family-cat-3)" },
  { key: "sim", label: "Compra simulada", color: "var(--family-cat-5)" },
];

const BASE_APORTE = 500;
const RESERVA = { saved: 2300, target: 10000 };

function useLayer1Demo() {
  const [aporte, setAporte] = useState(BASE_APORTE);
  const [extra, setExtra] = useState(false);
  const [horizon, setHorizon] = useState(12);
  const [selectedRaw, setSelected] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [view, setView] = useState<"cartao" | "metas">("cartao");
  const selected = Math.min(selectedRaw, horizon - 1);

  const base = useMemo(
    () =>
      Array.from({ length: horizon }, (_, i) => [
        230,
        650,
        i < 7 ? 260 : 0,
        i < 3 ? 160 : 0,
        0,
      ]),
    [horizon],
  );
  const values = useMemo(
    () => base.map((col, i) => col.map((v, l) => (l === 4 && extra && i >= 1 && i <= 6 ? 200 : v))),
    [base, extra],
  );
  const total = (col: number[]) => col.reduce((a, b) => a + b, 0);
  const totals = values.map(total);
  const baseTotals = base.map(total);

  const months = aporte > 0 ? Math.ceil((RESERVA.target - RESERVA.saved) / aporte) : null;
  const end = months !== null && months - 1 < horizon ? months - 1 : null;
  const baseEnd = Math.ceil((RESERVA.target - RESERVA.saved) / BASE_APORTE) - 1;
  const dirty = aporte !== BASE_APORTE || extra;
  const reset = () => {
    setAporte(BASE_APORTE);
    setExtra(false);
  };
  return {
    aporte, setAporte, extra, setExtra, horizon, setHorizon, selected, setSelected,
    sheet, setSheet, pressed, setPressed, view, setView,
    values, totals, baseTotals, end, baseEnd, dirty, reset,
  };
}
type Demo = ReturnType<typeof useLayer1Demo>;

function Layer1({ d, hidden, reader }: { d: Demo; hidden: boolean; reader: boolean }) {
  const saved12 = Math.min(RESERVA.target, RESERVA.saved + d.aporte * 12);
  const lanes: Lane[] = [
    {
      key: "reserva",
      label: "Reserva",
      color: "var(--family-cat-4)",
      end: d.end,
      endLabel:
        d.end === null ? "não completa no horizonte" : `${formatReais(RESERVA.target, hidden)} em ${shortLabel(d.end)}`,
    },
    {
      key: "viagem",
      label: "Viagem",
      color: "var(--family-cat-6)",
      end: d.horizon > 12 ? 12 : null,
      endLabel: d.horizon > 12 ? `${formatReais(4000, hidden)} em ${shortLabel(12)}` : "não completa no horizonte",
    },
  ];
  const items: RailItem[] = Array.from({ length: d.horizon }, (_, i) => {
    const free = 4100 - d.totals[i] - 700 - (i === 0 ? 0 : d.aporte) + 650;
    return {
      key: String(i),
      label: shortLabel(i),
      caption: `${formatSignedReais(free, hidden)} de folga`,
      marks: d.end === i ? 1 : 0,
      tone: free < 0 ? "danger" : d.end === i ? "ok" : undefined,
    };
  });
  const calc: CalcLine[] = [
    { key: "in", label: "Entrada", value: 6000, op: "+" },
    { key: "fix", label: "Contas fixas", value: -700, op: "−" },
    { key: "day", label: "Dia a dia fora do cartão", value: -650, op: "−", estimate: true },
    { key: "card", label: "Fatura do cartão", value: -d.totals[d.selected], op: "−", highlight: d.extra },
    { key: "res", label: "Para Reserva", value: -d.aporte, op: "−" },
  ];
  const calcTotal = calc.reduce((a, l) => a + l.value, 0);
  const baseCalcTotal = 6000 - 700 - 650 - d.baseTotals[d.selected] - BASE_APORTE;

  const diffs: DiffRow[] = [
    {
      key: "res",
      label: "Reserva completa",
      before: shortLabel(d.baseEnd),
      after: d.end === null ? "fora do horizonte" : shortLabel(d.end),
      sense: d.end === null ? -1 : Math.sign(d.baseEnd - d.end),
      delta: d.end === null || d.end === d.baseEnd ? undefined : `${Math.abs(d.baseEnd - d.end)} meses ${d.end < d.baseEnd ? "antes" : "depois"}`,
    },
    ...(d.extra
      ? [{ key: "fat", label: `Fatura de ${shortLabel(1)}`, before: formatReais(d.baseTotals[1], hidden), after: formatReais(d.totals[1], hidden), sense: -1, delta: formatSignedReais(200, hidden) }]
      : []),
  ].filter((r) => r.sense !== 0 || r.key === "fat");

  return (
    <>
      <section className={css.section}>
        <h2>Icon</h2>
        <div className={css.row}>
          {ICONS.map((n) => (
            <span key={n} className={css.row} title={n}>
              <Icon name={n} size={24} />
            </span>
          ))}
        </div>
      </section>

      <section className={css.section}>
        <h2>IconButton</h2>
        <div className={css.row}>
          <IconButton icon="minus" label="Diminuir aporte" onClick={() => d.setAporte(Math.max(0, d.aporte - 50))} />
          <IconButton icon="plus" label="Aumentar aporte" onClick={() => d.setAporte(Math.min(3000, d.aporte + 50))} />
          <IconButton icon="flag" label="Marcar" pressed={d.pressed} onClick={() => d.setPressed(!d.pressed)} />
          <IconButton icon="info" label="Informação" size="sm" onClick={() => {}} />
          <IconButton icon="close" label="Desabilitado" disabled onClick={() => {}} />
        </div>
      </section>

      <section className={css.section}>
        <h2>Segmented</h2>
        <div className={css.row}>
          <Segmented
            label="Quanto mostrar"
            value={d.horizon}
            onChange={d.setHorizon}
            options={[
              { value: 6, label: "6 meses" },
              { value: 12, label: "1 ano" },
              { value: 24, label: "2 anos" },
              { value: 36, label: "3 anos" },
            ]}
          />
          <Segmented
            label="Visão"
            size="sm"
            value={d.view}
            onChange={d.setView}
            options={[
              { value: "cartao", label: "Cartão" },
              { value: "metas", label: "Metas" },
            ]}
          />
        </div>
      </section>

      <section className={css.section}>
        <h2>AmountStepper, AnimatedMoney e ChangedText</h2>
        <div className={css.row}>
          <AmountStepper
            label="Aporte da reserva"
            value={d.aporte}
            onChange={d.setAporte}
            max={3000}
            hint={`Hoje: ${formatReais(BASE_APORTE, hidden)}`}
          />
          <div className={css.card}>
            <p className={css.muted}>Guardado em 12 meses</p>
            <p className={css.big}>
              <AnimatedMoney value={saved12} hidden={hidden} />
            </p>
            <p className={css.muted}>
              Folga <AnimatedMoney value={4100 - d.aporte - 650 - 700} signed hidden={hidden} />
            </p>
            <p>
              Reserva <ChangedText value={d.end === null ? "não completa" : `completa em ${shortLabel(d.end)}`} />
            </p>
          </div>
          <AmountStepper label="Compacto" compact value={d.aporte} onChange={d.setAporte} max={3000} />
          <AmountStepper label="Desabilitado" value={100} onChange={() => {}} disabled />
        </div>
      </section>

      <section className={css.section}>
        <h2>Sheet</h2>
        <button type="button" onClick={() => d.setSheet(true)}>Abrir painel</button>
        <Sheet
          open={d.sheet}
          onClose={() => d.setSheet(false)}
          title="O que muda"
          footer={<button type="button" onClick={() => d.setSheet(false)}>Fechar</button>}
        >
          <DiffList rows={diffs} />
        </Sheet>
      </section>

      <section className={css.section}>
        <h2>MonthRail</h2>
        <MonthRail
          label="Meses da jornada"
          items={items}
          selected={d.selected}
          onSelect={d.setSelected}
          renderSelected={(i) => (
            <div>
              <p>{longLabel(i)}</p>
              <p className={css.big}>
                <AnimatedMoney value={d.totals[i]} hidden={hidden} />
              </p>
              <p className={css.muted}>Fatura do mês</p>
            </div>
          )}
        />
      </section>

      <section className={css.section}>
        <h2>StackedBars</h2>
        <div className={css.row}>
          <button type="button" onClick={() => d.setExtra(!d.extra)} aria-pressed={d.extra}>
            {d.extra ? "Tirar compra simulada" : "Simular compra de R$ 1.200 em 6×"}
          </button>
        </div>
        <StackedBars
          label="Fatura do cartão por mês"
          columns={Array.from({ length: d.horizon }, (_, i) => MONTH_NAMES[at(i).m])}
          columnLabels={d.totals.map((t, i) => `${longLabel(i)}: fatura de ${formatReais(t, hidden)}`)}
          layers={LAYERS}
          values={d.values}
          ghost={d.extra ? d.baseTotals.map((t, i) => (t === d.totals[i] ? null : t)) : undefined}
          ghostLabel="Fatura no plano atual"
          selected={d.selected}
          onSelect={d.setSelected}
          footnotes={d.totals.map((_, i) => (i === 3 ? `−${formatReais(160, hidden)}` : null))}
          formatTotal={(v) => formatReais(v, hidden)}
        />
      </section>

      <section className={css.section}>
        <h2>LaneTracks</h2>
        <LaneTracks label="Objetivos no tempo" lanes={lanes} columns={d.horizon} selected={d.selected} onSelect={d.setSelected} />
      </section>

      <section className={css.section}>
        <h2>CalcList</h2>
        <div className={css.card}>
          <CalcList lines={calc} total={{ label: "Folga do mês", value: calcTotal }} compareTotal={baseCalcTotal} hidden={hidden} />
        </div>
      </section>

      <section className={css.section}>
        <h2>DiffList</h2>
        <DiffList rows={diffs} empty="Nada muda. Mexa no aporte ou simule a compra." />
      </section>

      <section className={css.section}>
        <h2>DraftBar</h2>
        <p className={css.muted}>Aparece ao mudar o aporte ou simular a compra{reader ? " (modo leitura: sem salvar)" : ""}.</p>
        <DraftBar
          open={d.dirty}
          summary={`${(d.aporte !== BASE_APORTE ? 1 : 0) + (d.extra ? 1 : 0)} mudança(s) · reserva ${d.end === null ? "fora do horizonte" : `completa em ${shortLabel(d.end)}`}`}
          onCompare={() => d.setSheet(true)}
          onDiscard={d.reset}
          onSave={reader ? undefined : () => { console.info("[vitrine] salvar", d.aporte); d.reset(); }}
          confirmSave="Gravar o novo aporte a partir de dez/26? Os planos anteriores ficam no histórico."
        />
      </section>
    </>
  );
}

// ---------- camada 2 ----------

function ContextPanel() {
  const f = useFutureContext();
  const goal = f.draftInput?.goals[0];
  return (
    <section className={css.section}>
      <h2>FutureProvider (estado)</h2>
      <p className={css.status} role="status">
        status {f.status} · horizonte {f.months} · mês {f.selected} · mudanças {f.changes} · {f.dirty ? "sujo" : "limpo"} ·{" "}
        {f.base ? `${f.base.rows.length} linhas` : "sem projeção"}
      </p>
      <div className={css.row}>
        <button
          type="button"
          disabled={!goal || !f.draftInput}
          onClick={() =>
            goal && f.draftInput && f.patch({ contributions: [{ goalId: goal.id, fromMonth: f.draftInput.startMonth, months: null, cents: 70000n }] })
          }
        >
          Simular aporte de R$ 700 em {goal?.name ?? "—"}
        </button>
        <button type="button" disabled={!f.dirty} onClick={f.discard}>Descartar</button>
      </div>
    </section>
  );
}

function GoalContributions() {
  const f = useFutureContext();
  const goals = (f.draftInput?.goals ?? []).filter((g) => g.status === "active");
  if (goals.length === 0) return <p className={css.note}>Nenhum objetivo ativo.</p>;
  return (
    <div className={css.row}>
      {goals.map((g) => (
        <ContributionControl key={g.id} goalId={g.id} />
      ))}
    </div>
  );
}

function Layer2() {
  return (
    <>
      <ContextPanel />
      <section className={css.section}>
        <h2>HorizonSwitch</h2>
        <HorizonSwitch />
      </section>
      <section className={css.section}>
        <h2>Headline</h2>
        <Headline />
      </section>
      <section className={css.section}>
        <h2>GoalLanes</h2>
        <GoalLanes />
      </section>
      <section className={css.section}>
        <h2>MonthStations e StationCard</h2>
        <MonthStations />
      </section>
      <section className={css.section}>
        <h2>CardBillChart e CardMonthPanel</h2>
        <CardBillChart />
      </section>
      <section className={css.section}>
        <h2>PurchaseSimulator</h2>
        <PurchaseSimulator />
      </section>
      <section className={css.section}>
        <h2>EverydayControl</h2>
        <EverydayControl />
      </section>
      <section className={css.section}>
        <h2>ContributionControl</h2>
        <GoalContributions />
      </section>
      <section className={css.section}>
        <h2>DecisionList</h2>
        <DecisionList />
      </section>
      <section className={css.section}>
        <h2>Premises</h2>
        <Premises />
      </section>
      <section className={css.section}>
        <h2>FutureDraftBar</h2>
        <p className={css.note}>Aparece colada ao fim da página quando há simulação não salva.</p>
        <FutureDraftBar />
      </section>
    </>
  );
}

// ---------- página ----------

function Showcase({ fixture, hidden, reader, newFont }: { fixture: Fixture; hidden: boolean; reader: boolean; newFont: boolean }) {
  const input = useMemo(() => inputFor(fixture), [fixture]);
  const store = useFixtureFuture(input);
  const demo = useLayer1Demo();
  const layer1 = <Layer1 d={demo} hidden={hidden} reader={reader} />;
  return (
    <>
      <p className={css.layer}>Camada 1 · app/ds</p>
      {newFont ? <FutureScope>{layer1}</FutureScope> : layer1}
      <p className={css.layer}>Camada 2 · app/future</p>
      <FutureProvider value={store} hidden={hidden} reader={reader}>
        <FutureScope>
          <Layer2 />
        </FutureScope>
      </FutureProvider>
    </>
  );
}

export default function FuturoShowcasePage() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [hidden, setHidden] = useState(false);
  const [reader, setReader] = useState(false);
  const [newFont, setNewFont] = useState(false);
  const [fixture, setFixture] = useState<Fixture>("briefing");

  useEffect(() => {
    const root = document.documentElement;
    const before = root.dataset.theme;
    root.dataset.theme = theme;
    return () => {
      if (before === undefined) delete root.dataset.theme;
      else root.dataset.theme = before;
    };
  }, [theme]);

  return (
    <main className={`family-app ${css.page}`}>
      <h1 className={css.title}>Vitrine · o futuro de vocês</h1>
      <p className={css.note}>Dados fixos, sem rede. Mexa nos controles para ver os movimentos.</p>
      <div className={css.controls} role="group" aria-label="Controles da vitrine">
        <Segmented
          label="Tema"
          size="sm"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Claro" },
            { value: "dark", label: "Escuro" },
          ]}
        />
        <Segmented
          label="Fixture"
          size="sm"
          value={fixture}
          onChange={setFixture}
          options={[
            { value: "briefing", label: "Briefing" },
            { value: "dia a dia", label: "Com dia a dia" },
            { value: "vazio", label: "Vazio" },
          ]}
        />
        <label className={css.check}>
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Ocultar valores
        </label>
        <label className={css.check}>
          <input type="checkbox" checked={reader} onChange={(e) => setReader(e.target.checked)} />
          Modo leitura
        </label>
        <label className={css.check}>
          <input type="checkbox" checked={newFont} onChange={(e) => setNewFont(e.target.checked)} />
          Fonte da nova tela (camada 1)
        </label>
      </div>
      <Showcase key={fixture} fixture={fixture} hidden={hidden} reader={reader} newFont={newFont} />
    </main>
  );
}
