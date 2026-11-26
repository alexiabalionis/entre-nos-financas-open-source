"use client";
import { useEffect, useMemo, useState } from "react";
import { baseBudget, fmt, monthLong, monthName, monthShort, yearOf } from "./engine.ts";
import {
  ChangedText,
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
  WhatIfs,
  monthKeys,
  smoothPath,
  useCopilot,
  useElementWidth,
  useTween,
  type Area,
} from "./kit.tsx";

const AREAS: { id: Area; label: string }[] = [
  { id: "futuro", label: "Estúdio" },
  { id: "dividas", label: "Dívidas" },
  { id: "objetivos", label: "Objetivos" },
  { id: "simular", label: "Decisões" },
];

type Band = { id: string; label: string; kind: "debt" | "goal" | "free"; tone: string; values: number[] };

export function BoldStudio() {
  const s = useCopilot();
  return (
    <div className="cf-d">
      <header className="cf-d-head">
        <span className="cf-d-word">Copiloto</span>
        <nav aria-label="Áreas do Copiloto" className="cf-d-nav">
          {AREAS.map((a) => (
            <button key={a.id} type="button" aria-current={s.area === a.id ? "page" : undefined} onClick={() => s.setArea(a.id)}>
              {a.label}
            </button>
          ))}
        </nav>
      </header>
      {s.area === "futuro" ? <Studio /> : null}
      {s.area === "dividas" ? (
        <section className="cf-d-section">
          <h2 className="cf-d-title">Dívidas</h2>
          <DebtsArea />
        </section>
      ) : null}
      {s.area === "objetivos" ? (
        <section className="cf-d-section">
          <h2 className="cf-d-title">Objetivos</h2>
          <GoalsArea />
        </section>
      ) : null}
      {s.area === "simular" ? (
        <section className="cf-d-section cf-d-decide">
          <h2 className="cf-d-title">Decisões</h2>
          <DecisionList onArea={(a) => s.setArea(a === "simular" ? "futuro" : a)} />
          <WhatIfs onApplied={() => s.setArea("futuro")} />
        </section>
      ) : null}
      <ScenarioDock />
    </div>
  );
}

function Studio() {
  const s = useCopilot();
  const [focus, setFocus] = useState<string | null>(null);
  const { setHorizon } = s;
  // a virada (fim das dívidas) só aparece com espaço depois dela
  useEffect(() => setHorizon(24), [setHorizon]);
  const next = s.pD.milestones.find((m) => m.kind === "debts-free") ?? s.pD.milestones.find((m) => m.kind === "debt-paid");
  const freed = s.draft.debts.reduce((a, d) => a + d.payment + d.extra, 0);
  const { y, m } = next ? { y: yearOf(next.month), m: monthName(next.month) } : { y: 0, m: "" };
  return (
    <section className="cf-d-studio" aria-label="Estúdio do futuro">
      <div className="cf-d-hero">
        {next ? (
          <>
            <p className="cf-d-lead">A virada acontece em</p>
            <p className="cf-d-giant" aria-label={monthLong(next.month)}>
              <ChangedText value={m} />
              <span className="cf-d-giant-year">
                <ChangedText value={String(y)} />
              </span>
            </p>
            <p className="cf-d-claim">
              Última parcela das dívidas. No mês seguinte, <Money v={freed} /> por mês {s.draft.snowball ? "passam a construir os objetivos" : "voltam para vocês"}.
            </p>
          </>
        ) : (
          <p className="cf-d-claim">As dívidas não terminam em 36 meses com este plano. Aumente um pagamento para ver a virada.</p>
        )}
      </div>
      <River focus={focus} onFocus={setFocus} />
      <div className="cf-d-lower">
        <Tiles />
        <FocusPanel focus={focus} onFocus={setFocus} />
      </div>
      <Premises className="cf-d-premises" />
    </section>
  );
}

function useBands(): { bands: Band[]; n: number } {
  const s = useCopilot();
  const n = s.horizon;
  return useMemo(() => {
    const rows = s.pD.rows.slice(0, n);
    const bands: Band[] = [];
    for (const d of s.draft.debts) bands.push({ id: d.id, label: d.name, kind: "debt", tone: "debt", values: rows.map((r) => r.debtPay[d.id] ?? 0) });
    for (const g of s.draft.goals)
      bands.push({ id: g.id, label: g.name, kind: "goal", tone: g.kind === "reserva" ? "res" : g.kind === "data" ? "trip" : "open", values: rows.map((r) => r.goalIn[g.id] ?? 0) });
    bands.push({ id: "free", label: "Folga livre", kind: "free", tone: "free", values: rows.map((r) => Math.max(0, r.free)) });
    return { bands, n };
  }, [s.pD, s.draft, n]);
}

function River({ focus, onFocus }: { focus: string | null; onFocus: (id: string | null) => void }) {
  const s = useCopilot();
  const { bands, n } = useBands();
  const [ref, w] = useElementWidth<HTMLDivElement>(900);
  const W = Math.max(w, n * 44);
  const H = 320;
  const top = 18;
  const bottomPad = 64;
  const budget = baseBudget(s.draft);
  const rows = s.pD.rows.slice(0, n);
  const maxStack = Math.max(budget, ...rows.map((r) => r.toDebts + r.toGoals + Math.max(0, r.free)));
  const maxNeg = Math.max(0, ...rows.map((r) => -Math.min(0, r.free)));
  const k = (H - top - bottomPad) / (maxStack + maxNeg);
  const base = top + maxStack * k;
  const col = W / n;
  const x = (i: number) => (i + 0.5) * col;
  const flat = bands.flatMap((b) => b.values).concat(rows.map((r) => -Math.min(0, r.free)));
  const tw = useTween(flat, 460);
  const val = (b: number, i: number) => tw[b * n + i] ?? 0;
  const deficit = (i: number) => tw[bands.length * n + i] ?? 0;

  const paths = bands.map((b, bi) => {
    const lower = (i: number) => {
      let acc = 0;
      for (let j = 0; j < bi; j++) acc += val(j, i);
      return acc;
    };
    const upper = (i: number) => lower(i) + val(bi, i);
    const pts = (f: (i: number) => number): [number, number][] => {
      const out: [number, number][] = [[0, base - f(0) * k]];
      for (let i = 0; i < n; i++) out.push([x(i), base - f(i) * k]);
      out.push([W, base - f(n - 1) * k]);
      return out;
    };
    const up = smoothPath(pts(upper));
    const lo = smoothPath(pts(lower).reverse());
    return { b, d: up + " L" + lo.slice(1) + " Z" };
  });
  const defPts: [number, number][] = [[0, base + deficit(0) * k], ...rows.map((_, i): [number, number] => [x(i), base + deficit(i) * k]), [W, base + deficit(n - 1) * k]];
  const defPath = smoothPath(defPts) + ` L${W} ${base} L0 ${base} Z`;
  const ends = s.pD.milestones.filter((m) => m.kind === "debt-paid" && m.month < n);

  return (
    <div className="cf-d-river-wrap">
      <div className="cf-d-river-head">
        <p>
          Para onde vai a verba de <strong>{fmt(budget)}</strong> em cada mês
        </p>
        <HorizonSwitch />
      </div>
      <div ref={ref} className="cf-d-river" tabIndex={0} role="group" aria-label="Fluxo mensal da verba. Setas trocam de mês." onKeyDown={monthKeys(s.sel, s.setSel, n)}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
          <defs>
            <pattern id="cf-d-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" className="cf-d-hatch-line" />
            </pattern>
          </defs>
          {paths.map(({ b, d }) => (
            <path
              key={b.id}
              d={d}
              className="cf-d-band"
              data-tone={b.tone}
              data-dim={(focus && focus !== b.id) || undefined}
              onClick={() => onFocus(focus === b.id ? null : b.id)}
            />
          ))}
          <path d={defPath} className="cf-d-deficit" />
          <line x1={0} x2={W} y1={base - budget * k} y2={base - budget * k} className="cf-d-budget" />
          <line x1={0} x2={W} y1={base} y2={base} className="cf-d-base" />
          {ends.map((m) => (
            <g key={m.id} className="cf-d-end" style={{ transform: `translateX(${x(m.month) + col / 2}px)` }}>
              <line x1={0} x2={0} y1={top} y2={base} />
            </g>
          ))}
          <line className="cf-d-scrub" x1={0} x2={0} y1={4} y2={H - bottomPad + 8} style={{ transform: `translateX(${x(s.sel)}px)` }} />
        </svg>
        <div className="cf-d-legend" style={{ width: W }}>
          {bands.map((b) => (
            <button key={b.id} type="button" data-tone={b.tone} aria-pressed={focus === b.id} onClick={() => onFocus(focus === b.id ? null : b.id)}>
              <span aria-hidden className="cf-d-swatch" />
              {b.label}
            </button>
          ))}
        </div>
        <div className="cf-d-ticks" style={{ width: W }}>
          {rows.map((_, i) => (
            <button key={i} type="button" tabIndex={-1} style={{ width: col }} aria-pressed={i === s.sel} aria-label={monthLong(i)} onClick={() => s.setSel(i)}>
              {n > 12 && i % 3 !== 0 && i !== s.sel ? "" : monthName(i)}
            </button>
          ))}
        </div>
      </div>
      <label className="cf-d-range">
        <span className="cf-sr">Mês em foco</span>
        <input type="range" min={0} max={n - 1} value={s.sel} onChange={(e) => s.setSel(Number(e.target.value))} aria-valuetext={monthLong(s.sel)} />
      </label>
    </div>
  );
}

/** Dívidas como blocos que se dissolvem e reservas como blocos que se assentam. Cada bloco tem valor fixo. */
function Tiles() {
  const s = useCopilot();
  const r = s.pD.rows[s.sel];
  const unitDebt = 200;
  const unitGoal = 500;
  return (
    <div className="cf-d-tiles">
      <header>
        <h3>
          Em <ChangedText value={monthShort(s.sel)} />
        </h3>
        <p>
          cada bloco de dívida = {fmt(unitDebt)} · cada bloco guardado = {fmt(unitGoal)}
        </p>
      </header>
      <div className="cf-d-tile-groups">
        {s.draft.debts.map((d) => {
          const total = Math.ceil(d.balance / unitDebt);
          const left = (r.debtBal[d.id] ?? 0) / unitDebt;
          return (
            <figure key={d.id} className="cf-d-tilefig" data-tone="debt">
              <div className="cf-d-grid" role="img" aria-label={`${d.name}: ${fmt(r.debtBal[d.id] ?? 0)} restantes de ${fmt(d.balance)}`}>
                {Array.from({ length: total }, (_, k) => (
                  <span key={k} data-gone={k >= Math.ceil(left - 1e-6) || undefined} style={{ transitionDelay: `${(k % 12) * 14}ms` }} />
                ))}
              </div>
              <figcaption>
                <strong>{d.name}</strong> <Money v={r.debtBal[d.id] ?? 0} /> restantes
              </figcaption>
            </figure>
          );
        })}
        {s.draft.goals
          .filter((g) => g.target !== null)
          .map((g) => {
            const total = Math.ceil((g.target ?? 0) / unitGoal);
            const have = (r.goalBal[g.id] ?? 0) / unitGoal;
            return (
              <figure key={g.id} className="cf-d-tilefig" data-tone={g.kind === "reserva" ? "res" : "trip"}>
                <div className="cf-d-grid" role="img" aria-label={`${g.name}: ${fmt(r.goalBal[g.id] ?? 0)} de ${fmt(g.target ?? 0)}`}>
                  {Array.from({ length: total }, (_, k) => (
                    <span key={k} data-on={k < Math.floor(have + 1e-6) || undefined} data-part={(k === Math.floor(have) && have % 1 > 0.01) || undefined} style={{ transitionDelay: `${(k % 12) * 14}ms` }} />
                  ))}
                </div>
                <figcaption>
                  <strong>{g.name}</strong> <Money v={r.goalBal[g.id] ?? 0} /> de {fmt(g.target ?? 0)}
                </figcaption>
              </figure>
            );
          })}
      </div>
    </div>
  );
}

function FocusPanel({ focus, onFocus }: { focus: string | null; onFocus: (id: string | null) => void }) {
  const s = useCopilot();
  const debt = s.draft.debts.find((d) => d.id === focus);
  const goal = s.draft.goals.find((g) => g.id === focus);
  if (!debt && !goal) {
    return (
      <div className="cf-d-focus">
        <h3>{monthLong(s.sel)}</h3>
        <MonthLedger i={s.sel} plan={s.draft} pr={s.pD} compareTo={s.dirty ? s.pS : undefined} />
        <p className="cf-d-hint">
          <Icon name="info" size={16} /> Toque numa faixa do rio para editar o valor dela.
        </p>
      </div>
    );
  }
  if (debt) {
    const at = s.pD.payoff[debt.id];
    return (
      <div className="cf-d-focus" data-tone="debt">
        <header>
          <h3>{debt.name}</h3>
          <button type="button" className="cf-icon-btn" onClick={() => onFocus(null)} aria-label="Fechar foco">
            <Icon name="close" size={16} />
          </button>
        </header>
        <p className="cf-d-focus-claim">
          {fmt(debt.payment + debt.extra)}/mês até <ChangedText value={at === null ? "depois de 3 anos" : monthLong(at)} />. Depois, essa faixa some do rio e o espaço vira {s.draft.snowball ? "aporte da próxima prioridade" : "folga"}.
        </p>
        <MoneyStepper label="Pagamento por mês" value={debt.payment + debt.extra} min={debt.payment} step={50} onChange={(v) => s.setDraft((p) => ({ ...p, debts: p.debts.map((d) => (d.id === debt.id ? { ...d, extra: v - d.payment } : d)) }))} />
        <label className="cf-check">
          <input type="checkbox" checked={s.draft.snowball} onChange={(e) => s.setDraft((p) => ({ ...p, snowball: e.target.checked }))} />
          Quando quitar, mandar o valor para a próxima prioridade
        </label>
      </div>
    );
  }
  const g = goal!;
  const at = s.pD.reach[g.id];
  return (
    <div className="cf-d-focus" data-tone={g.kind === "reserva" ? "res" : "trip"}>
      <header>
        <h3>{g.name}</h3>
        <button type="button" className="cf-icon-btn" onClick={() => onFocus(null)} aria-label="Fechar foco">
          <Icon name="close" size={16} />
        </button>
      </header>
      <p className="cf-d-focus-claim">
        {g.contribution === 0 ? "Ainda sem aporte." : `${fmt(g.contribution)}/mês.`} {g.target !== null ? <>Completa em <ChangedText value={at === null ? "mais de 3 anos" : monthLong(at)} />.</> : null}
      </p>
      <MoneyStepper label="Aporte por mês" value={g.contribution} step={50} onChange={(v) => s.setDraft((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, contribution: v } : x)) }))} />
    </div>
  );
}
