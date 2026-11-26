"use client";
import { Select } from "../ds/select.tsx";
import { useRef, useState } from "react";
import { baseBudget, fmt, monthLong, monthName, monthShort, type Plan, type Projection, type Row } from "./engine.ts";
import {
  DebtsArea,
  DecisionList,
  GoalsArea,
  HorizonSwitch,
  Icon,
  Money,
  MoneyStepper,
  MonthLedger,
  Premises,
  ScenarioDock,
  Segmented,
  WhatIfs,
  monthKeys,
  scale,
  smoothPath,
  useCopilot,
  useElementWidth,
  useTween,
  type Area,
} from "./kit.tsx";

const AREAS: { id: Area; label: string }[] = [
  { id: "futuro", label: "Simulador" },
  { id: "dividas", label: "Dívidas" },
  { id: "objetivos", label: "Objetivos" },
  { id: "simular", label: "Decisões" },
];

type Metric = "reserves" | "debtTotal" | "free" | "bank" | "netWorth";
const METRICS: { value: Metric; label: string; def: string }[] = [
  { value: "reserves", label: "Guardado", def: "Soma dos objetivos e reservas. Não é dinheiro para gasto corrente." },
  { value: "debtTotal", label: "Dívidas", def: "Saldo devedor restante das dívidas cadastradas." },
  { value: "free", label: "Folga", def: "O que sobra no mês depois de essenciais, compromissos, pagamentos e aportes." },
  { value: "bank", label: "Conta", def: "Saldo em conta projetado. Só cai quando falta folga no mês." },
  { value: "netWorth", label: "Patrimônio", def: "Conta + reservas − dívidas cadastradas. Bens não cadastrados ficam de fora." },
];

export function FutureSimulator() {
  const s = useCopilot();
  return (
    <div className="cf-c">
      <header className="cf-c-head">
        <h1>Simulador do futuro</h1>
        <nav aria-label="Áreas do Copiloto" className="cf-c-nav">
          {AREAS.map((a) => (
            <button key={a.id} type="button" aria-current={s.area === a.id ? "page" : undefined} onClick={() => s.setArea(a.id)}>
              {a.label}
            </button>
          ))}
        </nav>
      </header>
      {s.area === "futuro" ? <Simulator /> : null}
      {s.area === "dividas" ? (
        <section className="cf-c-section">
          <DebtsArea />
          <ScenarioDock />
        </section>
      ) : null}
      {s.area === "objetivos" ? (
        <section className="cf-c-section">
          <GoalsArea />
          <ScenarioDock />
        </section>
      ) : null}
      {s.area === "simular" ? (
        <section className="cf-c-section cf-c-decide">
          <DecisionList onArea={(a) => s.setArea(a === "simular" ? "futuro" : a)} />
        </section>
      ) : null}
    </div>
  );
}

function Simulator() {
  const s = useCopilot();
  const [metric, setMetric] = useState<Metric>("reserves");
  const def = METRICS.find((m) => m.value === metric)!;
  return (
    <div className="cf-c-grid">
      <div className="cf-c-main">
        <section className="cf-c-alloc" aria-labelledby="alloc-title">
          <div className="cf-c-alloc-head">
            <h2 id="alloc-title">Para onde vão os {fmt(baseBudget(s.draft))} de cada mês</h2>
            <p>Arraste as divisórias, ou use as setas com o foco nelas. A projeção responde na hora.</p>
          </div>
          <AllocationStrip />
        </section>
        <section className="cf-c-chart-sec" aria-label="Projeção antes e depois">
          <div className="cf-c-chart-head">
            <Segmented label="Grandeza do gráfico" value={metric} onChange={setMetric} options={METRICS.map(({ value, label }) => ({ value, label }))} />
            <HorizonSwitch />
          </div>
          <p className="cf-c-def">{def.def}</p>
          <CompareChart metric={metric} />
        </section>
        <section className="cf-c-events" aria-label="Eventos para testar">
          <h3>Testar um imprevisto</h3>
          <ShockControls />
          <h3>Ou um cenário pronto</h3>
          <WhatIfs />
        </section>
      </div>
      <aside className="cf-c-side">
        <ScenarioDock variant="panel" />
        <MonthReadout />
        <Premises />
      </aside>
    </div>
  );
}

type Seg = { id: string; label: string; amount: number; min: number; kind: "debt" | "goal"; tone: string };

function segments(p: Plan, pr: Projection): Seg[] {
  const out: Seg[] = [];
  for (const d of p.debts) {
    if (d.balance <= 0) continue;
    out.push({ id: d.id, label: d.name, amount: d.payment + d.extra, min: d.payment, kind: "debt", tone: "debt" });
  }
  for (const g of p.goals) {
    out.push({ id: g.id, label: g.name, amount: g.contribution, min: 0, kind: "goal", tone: g.kind === "reserva" ? "res" : g.kind === "data" ? "trip" : "open" });
  }
  void pr;
  return out;
}

function AllocationStrip() {
  const s = useCopilot();
  const budget = baseBudget(s.draft);
  const segs = segments(s.draft, s.pD);
  const savedSegs = segments(s.saved, s.pS);
  const total = segs.reduce((a, x) => a + x.amount, 0);
  const free = budget - total;
  const span = Math.max(budget, total) * 1.06;
  const [ref, w] = useElementWidth<HTMLDivElement>(700);
  const px = w / span;
  const drag = useRef<{ id: string; startX: number; startAmt: number } | null>(null);
  const widths = useTween(segs.map((x) => x.amount), 220);

  const setAmount = (seg: Seg, v: number) => {
    const val = Math.max(seg.min, Math.round(v / 10) * 10);
    s.setDraft((p) =>
      seg.kind === "debt"
        ? { ...p, debts: p.debts.map((d) => (d.id === seg.id ? { ...d, extra: val - d.payment } : d)) }
        : { ...p, goals: p.goals.map((g) => (g.id === seg.id ? { ...g, contribution: val } : g)) },
    );
  };
  let left = 0;
  return (
    <div className="cf-c-strip-wrap">
      <div ref={ref} className="cf-c-strip" data-over={free < 0 || undefined}>
        <span className="cf-c-budget-line" style={{ left: budget * px }} aria-hidden>
          <span>verba {fmt(budget)}</span>
        </span>
        {free < 0 ? <span className="cf-c-over" style={{ left: budget * px, width: -free * px }} aria-hidden /> : null}
        {segs.map((seg, k) => {
          const width = widths[k] * px;
          const x0 = left;
          left += width;
          const before = savedSegs.find((o) => o.id === seg.id)?.amount;
          return (
            <div key={seg.id} className="cf-c-seg" data-tone={seg.tone} data-zero={seg.amount === 0 || undefined} style={{ left: x0, width }}>
              <span className="cf-c-seg-label">
                <span>{seg.label}</span>
                <strong>{fmt(seg.amount)}</strong>
                {before !== undefined && before !== seg.amount ? <s>{fmt(before)}</s> : null}
              </span>
              <span
                className="cf-c-handle"
                data-label={seg.amount === 0 ? `+ ${seg.label}` : undefined}
                role="slider"
                tabIndex={0}
                aria-label={`${seg.label}, valor mensal`}
                aria-valuemin={seg.min}
                aria-valuemax={budget * 2}
                aria-valuenow={seg.amount}
                aria-valuetext={`${fmt(seg.amount)} por mês`}
                onKeyDown={(e) => {
                  const step = e.shiftKey ? 10 : 50;
                  if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    setAmount(seg, seg.amount + step);
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setAmount(seg, seg.amount - step);
                  }
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { id: seg.id, startX: e.clientX, startAmt: seg.amount };
                }}
                onPointerMove={(e) => {
                  if (!drag.current || drag.current.id !== seg.id) return;
                  setAmount(seg, drag.current.startAmt + (e.clientX - drag.current.startX) / px);
                }}
                onPointerUp={() => (drag.current = null)}
                onPointerCancel={() => (drag.current = null)}
              />
            </div>
          );
        })}
        {free > 0 ? (
          <div className="cf-c-free" style={{ left, width: free * px }}>
            <span>Folga</span>
            <strong>{fmt(free)}</strong>
          </div>
        ) : null}
      </div>
      <p className={"cf-c-strip-note" + (free < 0 ? " is-over" : "")} aria-live="polite">
        {free < 0 ? (
          <>
            <Icon name="alert" size={16} /> Passou da verba em {fmt(-free)}/mês. A diferença sairia do saldo em conta.
          </>
        ) : (
          <>
            Alocado {fmt(total)} de {fmt(budget)} · folga livre de {fmt(free)}/mês
            {s.pD.rows.slice(0, s.horizon).some((r) => r.free < 0) ? ", mas há meses sem folga no horizonte" : ""}.
          </>
        )}
      </p>
      <div className="cf-c-fine" aria-label="Ajuste fino">
        {segs.map((seg) => (
          <MoneyStepper key={seg.id} compact label={seg.label} value={seg.amount} min={seg.min} step={50} onChange={(v) => setAmount(seg, v)} />
        ))}
      </div>
    </div>
  );
}

function CompareChart({ metric }: { metric: Metric }) {
  const s = useCopilot();
  const n = s.horizon;
  const [ref, w] = useElementWidth<HTMLDivElement>(760);
  const W = Math.max(w, n * 40);
  const H = 260;
  const pad = { l: 8, r: 8, t: 22, b: 30 };
  const col = (W - pad.l - pad.r) / n;
  const x = (i: number) => pad.l + (i + 0.5) * col;
  const get = (r: Row) => r[metric];
  const A = s.pS.rows.slice(0, n).map(get);
  const B = s.pD.rows.slice(0, n).map(get);
  const lo = Math.min(0, ...A, ...B);
  const hi = Math.max(1, ...A, ...B);
  const y = scale(lo, hi, H - pad.b, pad.t);
  const tw = useTween([...B, lo, hi], 440);
  const tB = tw.slice(0, n);
  const yT = scale(tw[n], tw[n + 1], H - pad.b, pad.t);
  const line = (vs: number[], yy: (v: number) => number) => smoothPath(vs.map((v, i): [number, number] => [x(i), yy(v)]));
  const ids = new Set([...s.pS.milestones, ...s.pD.milestones].map((m) => m.id));
  const moved = [...ids]
    .map((id) => ({ a: s.pS.milestones.find((m) => m.id === id), b: s.pD.milestones.find((m) => m.id === id) }))
    .filter(({ a, b }) => (a && a.month < n) || (b && b.month < n));
  return (
    <div ref={ref} className="cf-c-chart" tabIndex={0} role="group" aria-label={`Gráfico de ${METRICS.find((m) => m.value === metric)?.label}. Setas trocam de mês.`} onKeyDown={monthKeys(s.sel, s.setSel, n)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <rect className="cf-c-selband" x={0} y={pad.t - 10} width={col} height={H - pad.b - pad.t + 10} style={{ transform: `translateX(${pad.l + s.sel * col}px)` }} />
        {lo < 0 ? <line className="cf-c-zero" x1={pad.l} x2={W - pad.r} y1={yT(0)} y2={yT(0)} /> : null}
        <line className="cf-c-base" x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} />
        {s.dirty ? <path d={line(A, y)} className="cf-c-before" /> : null}
        <path d={line(tB, yT) + ` L${x(n - 1)} ${yT(Math.max(lo, 0))} L${x(0)} ${yT(Math.max(lo, 0))} Z`} className="cf-c-area" />
        <path d={line(tB, yT)} className="cf-c-after" />
        {moved.map(({ a, b }) =>
          a && b && a.month !== b.month && a.month < n && b.month < n ? (
            <g key={b.id} className="cf-c-shift">
              <line x1={x(a.month)} x2={x(b.month)} y1={pad.t - 8} y2={pad.t - 8} />
              <circle cx={x(a.month)} cy={pad.t - 8} r={4} className="is-old" />
              <circle cx={x(b.month)} cy={pad.t - 8} r={5} />
            </g>
          ) : b && b.month < n ? (
            <circle key={b.id} cx={x(b.month)} cy={pad.t - 8} r={4} className={"cf-c-mile" + (b.missed ? " is-missed" : "")} />
          ) : null,
        )}
        <circle className="cf-c-dot" cx={x(s.sel)} cy={yT(tB[s.sel] ?? 0)} r={5} />
      </svg>
      <div className="cf-c-xaxis" style={{ width: W }}>
        {Array.from({ length: n }, (_, i) => (
          <button key={i} type="button" tabIndex={-1} style={{ width: col }} aria-pressed={i === s.sel} onClick={() => s.setSel(i)} aria-label={monthLong(i)}>
            {n > 12 && i % 2 === 1 ? "" : monthName(i)}
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthReadout() {
  const s = useCopilot();
  return (
    <section className="cf-c-readout" aria-label={`Leitura de ${monthLong(s.sel)}`}>
      <header>
        <button type="button" className="cf-icon-btn" aria-label="Mês anterior" disabled={s.sel === 0} onClick={() => s.setSel(s.sel - 1)}>
          <Icon name="left" />
        </button>
        <h3>{monthLong(s.sel)}</h3>
        <button type="button" className="cf-icon-btn" aria-label="Próximo mês" disabled={s.sel >= s.horizon - 1} onClick={() => s.setSel(s.sel + 1)}>
          <Icon name="right" />
        </button>
      </header>
      <MonthLedger i={s.sel} plan={s.draft} pr={s.pD} compareTo={s.dirty ? s.pS : undefined} />
      {s.pD.milestones
        .filter((m) => m.month === s.sel)
        .map((m) => (
          <div key={m.id} className="cf-c-mwhy">
            <h4>{m.title}</h4>
            <ul>
              {m.why.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function ShockControls() {
  const s = useCopilot();
  const shock = s.draft.shocks.find((x) => x.id === "custom-expense");
  const income = s.draft.shocks.find((x) => x.id === "custom-income");
  const upsert = (id: string, patch: Partial<Plan["shocks"][number]> | null, base: Plan["shocks"][number]) =>
    s.setDraft((p) => {
      const rest = p.shocks.filter((x) => x.id !== id);
      if (!patch) return { ...p, shocks: rest };
      const cur = p.shocks.find((x) => x.id === id) ?? base;
      return { ...p, shocks: [...rest, { ...cur, ...patch }] };
    });
  const baseExp = { id: "custom-expense", kind: "despesa" as const, from: 2, months: 1, amount: 1000, label: "Despesa inesperada" };
  const baseInc = { id: "custom-income", kind: "receita" as const, from: 2, months: 2, amount: 800, label: "Receita menor" };
  return (
    <div className="cf-c-shocks">
      <div className="cf-c-shock" data-on={!!shock || undefined}>
        <label className="cf-check">
          <input type="checkbox" checked={!!shock} onChange={(e) => upsert(baseExp.id, e.target.checked ? {} : null, baseExp)} />
          Despesa inesperada
        </label>
        {shock ? (
          <div className="cf-c-shock-row">
            <MoneyStepper compact label="Valor" value={shock.amount} step={100} onChange={(v) => upsert(baseExp.id, { amount: v, label: `Imprevisto de ${fmt(v)}` }, baseExp)} />
            <div className="cf-field">
              <label htmlFor="shock-month">Mês</label>
              <Select id="shock-month" value={shock.from} onChange={(e) => upsert(baseExp.id, { from: Number(e.target.value) }, baseExp)}>
                {Array.from({ length: s.horizon }, (_, i) => (
                  <option key={i} value={i}>
                    {monthShort(i)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </div>
      <div className="cf-c-shock" data-on={!!income || undefined}>
        <label className="cf-check">
          <input type="checkbox" checked={!!income} onChange={(e) => upsert(baseInc.id, e.target.checked ? {} : null, baseInc)} />
          Receita menor por um tempo
        </label>
        {income ? (
          <div className="cf-c-shock-row">
            <MoneyStepper compact label="Redução por mês" value={income.amount} step={100} onChange={(v) => upsert(baseInc.id, { amount: v }, baseInc)} />
            <div className="cf-field">
              <label htmlFor="inc-months">Por quantos meses</label>
              <Select id="inc-months" value={income.months} onChange={(e) => upsert(baseInc.id, { months: Number(e.target.value) }, baseInc)}>
                {[1, 2, 3, 4, 6].map((m) => (
                  <option key={m} value={m}>
                    {m} {m === 1 ? "mês" : "meses"} desde {monthShort(income.from)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </div>
      {shock || income ? (
        <p className="cf-c-shock-note">
          Folga mínima no horizonte: <Money v={Math.min(...s.pD.rows.slice(0, s.horizon).map((r) => r.free))} />. A reserva não é usada sozinha: o que faltar sai da conta.
        </p>
      ) : null}
    </div>
  );
}
