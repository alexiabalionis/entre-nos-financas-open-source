"use client";
import { useMemo, useState } from "react";
import { fmt, monthLong, monthName, monthShort, yearOf, type Milestone } from "./engine.ts";
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
import { LaneMap, Stations } from "./b-journey.tsx";
import { CardProjection } from "./card-projection.tsx";

const AREAS: { id: Area; label: string }[] = [
  { id: "futuro", label: "Trajetória" },
  { id: "dividas", label: "Dívidas" },
  { id: "objetivos", label: "Objetivos" },
  { id: "simular", label: "Decisões" },
];

/** journey = moldura editorial do A com os trilhos e estações do B como linha do tempo. */
export function EditorialTimeline({ journey = false }: { journey?: boolean }) {
  const s = useCopilot();
  return (
    <div className={"cf-a" + (journey ? " cf-ab" : "")}>
      <header className="cf-a-mast">
        <div className="cf-a-brand">
          <h1>Copiloto</h1>
          <p>O futuro de vocês, mês a mês</p>
        </div>
        <nav aria-label="Áreas do Copiloto" className="cf-a-nav">
          {AREAS.map((a) => (
            <button key={a.id} type="button" aria-current={s.area === a.id ? "page" : undefined} onClick={() => s.setArea(a.id)}>
              {a.label}
            </button>
          ))}
        </nav>
      </header>
      {s.area === "futuro" ? <Trajectory journey={journey} /> : null}
      {s.area === "dividas" ? (
        <section className="cf-a-section">
          <h2 className="cf-a-h2">Dívidas</h2>
          <p className="cf-a-lede">Saldo, condições e quitação de cada uma. Simule um pagamento extra e veja o efeito na folga.</p>
          <DebtsArea />
        </section>
      ) : null}
      {s.area === "objetivos" ? (
        <section className="cf-a-section">
          <h2 className="cf-a-h2">Reservas e objetivos</h2>
          <p className="cf-a-lede">Cada objetivo mostra de onde vem o aporte e quando completa. Pausar é um caminho normal.</p>
          <GoalsArea />
        </section>
      ) : null}
      {s.area === "simular" ? (
        <section className="cf-a-section cf-a-decide">
          <div>
            <h2 className="cf-a-h2">Próximas decisões</h2>
            <p className="cf-a-lede">Cada nota sai de uma conta sobre o plano atual. A conta está à vista.</p>
            <DecisionList onArea={(a) => s.setArea(a === "simular" ? "futuro" : a)} />
          </div>
          <aside>
            <h3 className="cf-a-h3">Experimentar</h3>
            <WhatIfs onApplied={() => s.setArea("futuro")} />
          </aside>
        </section>
      ) : null}
      <ScenarioDock />
    </div>
  );
}

function Headline() {
  const s = useCopilot();
  const pr = s.pD;
  const debtsFree = pr.milestones.find((m) => m.kind === "debts-free") ?? pr.milestones.find((m) => m.kind === "debt-paid");
  const reserve = s.draft.goals.find((g) => g.kind === "reserva");
  const reserveAt = reserve ? pr.reach[reserve.id] : null;
  const trip = pr.milestones.find((m) => m.kind === "goal-due");
  return (
    <div className="cf-a-headline" aria-live="polite">
      <p className="cf-a-h1">
        {debtsFree ? (
          <>
            Em <ChangedText className="cf-a-em" value={monthLong(debtsFree.month)} />, vocês terminam de pagar as dívidas.
          </>
        ) : (
          <>As dívidas não terminam nos próximos três anos com o plano atual.</>
        )}{" "}
        {reserve && reserveAt !== null ? (
          <span className="cf-a-h1-soft">
            A reserva chega a {fmt(reserve.target ?? 0)} em <ChangedText className="cf-a-em" value={monthLong(reserveAt)} />.
          </span>
        ) : null}
      </p>
      {trip ? (
        <p className="cf-a-sub">
          {trip.missed ? (
            <>
              A viagem de {monthShort(trip.month)} ainda não tem aporte: chegaria com{" "}
              <Money v={pr.rows[trip.month].goalBal[trip.refId]} /> dos {fmt(s.draft.goals.find((g) => g.id === trip.refId)?.target ?? 0)}.
            </>
          ) : (
            <>A viagem de {monthShort(trip.month)} está coberta pelo plano.</>
          )}
        </p>
      ) : null}
    </div>
  );
}

function Trajectory({ journey }: { journey: boolean }) {
  const s = useCopilot();
  const [focus, setFocus] = useState<string | null>(null);
  const ms = s.pD.milestones.filter((m) => m.month < s.horizon);
  const focused = ms.find((m) => m.id === focus) ?? null;
  return (
    <section className="cf-a-traj" aria-label="Trajetória">
      <Headline />
      {journey ? (
        <>
          <div className="cf-a-toolbar">
            <p className="cf-ab-where">
              Em <strong>{monthLong(s.sel)}</strong>: <Money v={s.pD.rows[s.sel].reserves} /> guardados, <Money v={s.pD.rows[s.sel].debtTotal} /> em dívidas.
            </p>
            <HorizonSwitch />
          </div>
          <LaneMap className="cf-ab-map" />
          {/* o card da estação (fluxo do mês, porquês e acelerar) substitui o fólio do A */}
          <Stations />
          <CardProjection />
          <div className="cf-ab-after">
            <div className="cf-a-next">
              <h3 className="cf-a-h3">Próximo passo</h3>
              <DecisionList onArea={(a) => s.setArea(a === "simular" ? "futuro" : a)} />
            </div>
            <Premises />
          </div>
        </>
      ) : (
        <>
          <div className="cf-a-toolbar">
            <div className="cf-a-legend" aria-hidden>
              <span className="is-res">Guardado em objetivos</span>
              <span className="is-debt">Dívidas restantes</span>
              {s.dirty ? <span className="is-ghost">Plano atual</span> : null}
            </div>
            <HorizonSwitch />
          </div>
          <Timeline milestones={ms} focus={focus} onFocus={setFocus} />
          <div className="cf-a-folio">
            <MonthFolio />
            <div className="cf-a-side">
              {focused ? (
                <MilestoneNote m={focused} onClose={() => setFocus(null)} />
              ) : (
                <div className="cf-a-next">
                  <h3 className="cf-a-h3">Próximo passo</h3>
                  <DecisionList onArea={(a) => s.setArea(a === "simular" ? "futuro" : a)} />
                </div>
              )}
              <Premises />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function Timeline({ milestones, focus, onFocus }: { milestones: Milestone[]; focus: string | null; onFocus: (id: string | null) => void }) {
  const s = useCopilot();
  const n = s.horizon;
  const [ref, w] = useElementWidth<HTMLDivElement>();
  const colMin = 54;
  const W = Math.max(w, n * colMin);
  const H = 300;
  const mid = 168;
  const col = W / n;
  const x = (i: number) => (i + 0.5) * col;

  const goals = s.draft.goals;
  const debts = s.draft.debts;
  const rows = s.pD.rows.slice(0, n);
  const ghost = s.pS.rows.slice(0, n);
  const maxRes = Math.max(1, ...rows.map((r) => r.reserves), ...ghost.map((r) => r.reserves));
  const maxDebt = Math.max(1, ...rows.map((r) => r.debtTotal), ...ghost.map((r) => r.debtTotal), s.draft.debts.reduce((a, d) => a + d.balance, 0));
  const k = Math.max(maxRes / (mid - 34), maxDebt / (H - mid - 22));
  const up = (v: number) => mid - v / k;
  const dn = (v: number) => mid + v / k;

  // séries empilhadas achatadas num vetor só: o tween morfa tudo junto
  const flat = useMemo(() => {
    const out: number[] = [];
    for (const r of rows) {
      let acc = 0;
      for (const g of goals) {
        acc += r.goalBal[g.id] ?? 0;
        out.push(acc);
      }
      let dacc = 0;
      for (const d of debts) {
        dacc += r.debtBal[d.id] ?? 0;
        out.push(dacc);
      }
    }
    return out;
  }, [rows, goals, debts]);
  const tw = useTween(flat, 440);
  const stride = goals.length + debts.length;
  const at = (i: number, j: number) => tw[i * stride + j] ?? 0;

  const band = (j: number, side: "up" | "dn") => {
    const f = side === "up" ? up : dn;
    const top: [number, number][] = rows.map((_, i): [number, number] => [x(i), f(at(i, j))]);
    const bot: [number, number][] = rows.map((_, i): [number, number] => [x(i), j === 0 || (side === "dn" && j === goals.length) ? mid : f(at(i, j - 1))]).reverse();
    return smoothPath(top) + " L" + smoothPath(bot).slice(1) + " Z";
  };
  const ghostUp = smoothPath(ghost.map((r, i): [number, number] => [x(i), up(r.reserves)]));
  const ghostDn = smoothPath(ghost.map((r, i): [number, number] => [x(i), dn(r.debtTotal)]));

  // empilha os marcos em linhas sem sobreposição horizontal (rótulo ≈ 7px/caractere)
  const placed = (() => {
    const rowsEnd: number[] = [];
    return [...milestones]
      .sort((a, b) => a.month - b.month)
      .map((m) => {
        const wLabel = m.short.length * 7 + 34;
        const flip = x(m.month) > W - 190;
        const l = flip ? x(m.month) + 11 - wLabel : x(m.month) - 11;
        let row = rowsEnd.findIndex((end) => end + 8 < l);
        if (row < 0) row = rowsEnd.length;
        rowsEnd[row] = l + wLabel;
        return { m, row, flip };
      });
  })();
  const sel = s.sel;

  return (
    <div className="cf-a-timeline-wrap">
      <div ref={ref} className="cf-a-timeline" tabIndex={0} role="group" aria-label={`Linha do tempo de ${n} meses. Use as setas para trocar de mês.`} onKeyDown={monthKeys(sel, s.setSel, n)}>
        <div className="cf-a-canvas" style={{ width: W, ["--pins-h" as string]: `${Math.max(2, ...placed.map((p) => p.row + 1)) * 26 + 18}px` }}>
          <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden className="cf-a-svg">
            <rect className="cf-a-selcol" x={0} y={0} width={col} height={H} style={{ transform: `translateX(${sel * col}px)` }} />
            {rows.map((_, i) =>
              yearOf(i) !== yearOf(i - 1) && i > 0 ? <line key={"y" + i} x1={i * col} x2={i * col} y1={14} y2={H} className="cf-a-yearline" /> : null,
            )}
            {goals.map((g, j) => (
              <path key={g.id} d={band(j, "up")} className={"cf-a-band is-res-" + (j % 3)} />
            ))}
            {debts.map((d, j) => (
              <path key={d.id} d={band(goals.length + j, "dn")} className={"cf-a-band is-debt-" + (j % 3)} />
            ))}
            {s.dirty ? (
              <>
                <path d={ghostUp} className="cf-a-ghost" />
                <path d={ghostDn} className="cf-a-ghost" />
              </>
            ) : null}
            <line x1={0} x2={W} y1={mid} y2={mid} className="cf-a-axis" />
            {rows.map((r, i) =>
              r.free < 0 ? <circle key={"t" + i} cx={x(i)} cy={mid} r={4.5} className="cf-a-tight" /> : null,
            )}
          </svg>
          <div className="cf-a-pins">
            {placed.map(({ m, row: k, flip }) => (
                <button
                  key={m.id}
                  type="button"
                  className="cf-a-pin"
                  data-kind={m.kind}
                  data-missed={m.missed || undefined}
                  data-passed={sel >= m.month || undefined}
                  aria-pressed={focus === m.id}
                  data-flip={flip || undefined}
                  style={{
                    transform:
                      flip
                        ? `translate(${x(m.month)}px, ${k * 26}px) translateX(calc(-100% + 22px))`
                        : `translate(${x(m.month)}px, ${k * 26}px)`,
                  }}
                  onClick={() => {
                    onFocus(focus === m.id ? null : m.id);
                    s.setSel(m.month);
                  }}
                >
                  <span className="cf-a-pin-dot" aria-hidden>
                    {sel >= m.month && !m.missed ? <Icon name="check" size={11} /> : null}
                  </span>
                  <span className="cf-a-pin-label">{m.short}</span>
                </button>
              ))}
          </div>
          <div className="cf-a-months" role="tablist" aria-label="Meses">
            {rows.map((r, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === sel}
                tabIndex={-1}
                style={{ width: col }}
                onClick={() => s.setSel(i)}
                aria-label={monthLong(i) + (r.free < 0 ? ", sem folga" : "")}
              >
                <span>{monthName(i)}</span>
                {i === 0 || monthName(i) === "jan" ? <small>{yearOf(i)}</small> : null}
              </button>
            ))}
          </div>
          <span className="cf-a-cursor" aria-hidden style={{ transform: `translateX(${x(sel)}px)` }} />
        </div>
      </div>
    </div>
  );
}

function MonthFolio() {
  const s = useCopilot();
  const i = s.sel;
  const r = s.pD.rows[i];
  const [adjust, setAdjust] = useState(false);
  const reserve = s.draft.goals.find((g) => g.kind === "reserva");
  return (
    <article className="cf-a-month" aria-label={`Mês selecionado: ${monthLong(i)}`}>
      <header className="cf-a-month-head">
        <button type="button" className="cf-icon-btn" aria-label="Mês anterior" disabled={i === 0} onClick={() => s.setSel(i - 1)}>
          <Icon name="left" />
        </button>
        <h2>
          <ChangedText value={monthLong(i)} />
        </h2>
        <button type="button" className="cf-icon-btn" aria-label="Próximo mês" disabled={i >= s.horizon - 1} onClick={() => s.setSel(i + 1)}>
          <Icon name="right" />
        </button>
      </header>
      <div className="cf-a-month-figure">
        <span>{r.free < 0 ? "Falta neste mês" : "Folga livre neste mês"}</span>
        <Money v={r.free} className={"cf-a-big" + (r.free < 0 ? " is-neg" : "")} />
        <p>
          Saldo em conta ao fim do mês: <Money v={r.bank} />
          {reserve ? (
            <>
              {" · "}reserva: <Money v={r.goalBal[reserve.id]} />
            </>
          ) : null}
        </p>
      </div>
      <MonthLedger i={i} plan={s.draft} pr={s.pD} compareTo={s.dirty ? s.pS : undefined} />
      <div className="cf-a-adjust">
        <button type="button" className="cf-btn is-line" aria-expanded={adjust} onClick={() => setAdjust(!adjust)}>
          <Icon name="layers" size={16} /> {adjust ? "Fechar ajustes" : "Ajustar pagamentos e aportes"}
        </button>
        {adjust ? (
          <div className="cf-a-adjust-grid">
            {s.draft.debts.map((d) => (
              <MoneyStepper
                key={d.id}
                compact
                label={`${d.name} / mês`}
                value={d.payment + d.extra}
                min={d.payment}
                step={50}
                onChange={(v) => s.setDraft((p) => ({ ...p, debts: p.debts.map((x) => (x.id === d.id ? { ...x, extra: v - x.payment } : x)) }))}
              />
            ))}
            {s.draft.goals.map((g) => (
              <MoneyStepper
                key={g.id}
                compact
                label={`${g.name} / mês`}
                value={g.contribution}
                step={50}
                onChange={(v) => s.setDraft((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, contribution: v } : x)) }))}
              />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MilestoneNote({ m, onClose }: { m: Milestone; onClose: () => void }) {
  return (
    <article className="cf-a-note" data-kind={m.kind} aria-live="polite">
      <header>
        <span>{monthLong(m.month)}</span>
        <button type="button" className="cf-icon-btn" onClick={onClose} aria-label="Fechar marco">
          <Icon name="close" size={16} />
        </button>
      </header>
      <h3>{m.title}</h3>
      <p className="cf-a-note-why">Por que nessa data</p>
      <ol>
        {m.why.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ol>
    </article>
  );
}
