"use client";
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
  useCopilot,
  useTween,
  type Area,
} from "./kit.tsx";

const AREAS: { id: Area; label: string }[] = [
  { id: "futuro", label: "Jornada" },
  { id: "dividas", label: "Dívidas" },
  { id: "objetivos", label: "Objetivos" },
  { id: "simular", label: "Decisões" },
];

export function FinancialJourney() {
  const s = useCopilot();
  return (
    <div className="cf-b">
      <header className="cf-b-head">
        <h1>
          Copiloto <span>· a jornada de vocês</span>
        </h1>
        <nav className="cf-b-nav" aria-label="Áreas do Copiloto">
          {AREAS.map((a) => (
            <button key={a.id} type="button" aria-current={s.area === a.id ? "page" : undefined} onClick={() => s.setArea(a.id)}>
              {a.label}
            </button>
          ))}
        </nav>
      </header>
      {s.area === "futuro" ? <Journey /> : null}
      {s.area === "dividas" ? (
        <section className="cf-b-section">
          <h2>Dívidas no caminho</h2>
          <DebtsArea />
        </section>
      ) : null}
      {s.area === "objetivos" ? (
        <section className="cf-b-section">
          <h2>Para onde vocês estão indo</h2>
          <GoalsArea />
        </section>
      ) : null}
      {s.area === "simular" ? (
        <section className="cf-b-section cf-b-decide">
          <div>
            <h2>Decisões pela frente</h2>
            <DecisionList onArea={(a) => s.setArea(a === "simular" ? "futuro" : a)} />
          </div>
          <div>
            <h3>Testar um desvio</h3>
            <WhatIfs onApplied={() => s.setArea("futuro")} />
          </div>
        </section>
      ) : null}
      <ScenarioDock />
    </div>
  );
}

type Lane = { id: string; label: string; kind: "debt" | "goal"; start: number; end: number | null; startLabel: string; endLabel: string; tone: string };

function useLanes(): Lane[] {
  const s = useCopilot();
  const lanes: Lane[] = [];
  for (const d of s.draft.debts) {
    const at = s.pD.payoff[d.id];
    lanes.push({
      id: d.id,
      label: d.name,
      kind: "debt",
      start: 0,
      end: at,
      startLabel: fmt(d.balance),
      endLabel: at === null ? "além de 3 anos" : "quitada " + monthShort(at),
      tone: "debt",
    });
  }
  for (const g of s.draft.goals) {
    const at = s.pD.reach[g.id];
    lanes.push({
      id: g.id,
      label: g.name,
      kind: "goal",
      start: 0,
      end: at,
      startLabel: fmt(g.saved),
      endLabel: g.target === null ? "sem meta" : at === null ? "não completa no horizonte" : `${fmt(g.target)} em ${monthShort(at)}`,
      tone: g.kind === "reserva" ? "res" : "trip",
    });
  }
  return lanes;
}

function Journey() {
  const s = useCopilot();
  const r0 = s.pD.rows[s.sel];
  return (
    <section className="cf-b-journey" aria-label="Jornada">
      <div className="cf-b-intro">
        <p className="cf-b-where">
          Vocês estão em <strong>{monthLong(s.sel)}</strong>
          {s.sel === 0 ? ", o próximo mês" : `, daqui a ${s.sel} ${s.sel === 1 ? "mês" : "meses"}`}.
        </p>
        <p className="cf-b-state">
          Até lá: <Money v={r0.reserves} /> guardados, <Money v={r0.debtTotal} /> ainda em dívidas.
        </p>
        <HorizonSwitch />
      </div>

      <LaneMap />

      <Stations />
      <Premises className="cf-b-premises" />
    </section>
  );
}

export function LaneMap({ className }: { className?: string }) {
  const s = useCopilot();
  const n = s.horizon;
  const lanes = useLanes();
  const ends = useTween(lanes.map((l) => (l.end === null ? n : Math.min(n, l.end + 1))), 460);
  const cursor = useTween([s.sel + 0.5], 380)[0];
  return (
      <div className={"cf-b-map " + (className ?? "")} role="group" aria-label="Trilhos de cada dívida e objetivo">
        {lanes.map((l, k) => (
          <div key={l.id} className="cf-b-lane" data-tone={l.tone}>
            <span className="cf-b-lane-name">{l.label}</span>
            <div
              className="cf-b-track"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                s.setSel(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - rect.left) / rect.width) * n))));
              }}
            >
              <span className="cf-b-track-run" style={{ width: `${(Math.min(ends[k], n) / n) * 100}%` }} />
              {l.end !== null && l.end < n ? (
                <span className="cf-b-flag" style={{ left: `${((l.end + 0.5) / n) * 100}%` }} data-passed={s.sel >= l.end || undefined} aria-hidden>
                  <Icon name="flag" size={13} />
                </span>
              ) : (
                <span className="cf-b-beyond" aria-hidden>
                  <Icon name="right" size={13} />
                </span>
              )}
            </div>
            <span className="cf-b-lane-end">
              <ChangedText value={l.endLabel} />
            </span>
          </div>
        ))}
        <span className="cf-b-traveler" aria-hidden style={{ left: `calc(var(--lane-label) + (100% - var(--lane-label) - var(--lane-end)) * ${cursor / n})` }} />
      </div>
  );
}

export function Stations({
  expand = true,
  focus,
  onEvent,
}: {
  expand?: boolean;
  focus?: string | null;
  onEvent?: (id: string) => void;
}) {
  const s = useCopilot();
  const n = s.horizon;
  const byMonth = new Map<number, Milestone[]>();
  for (const m of s.pD.milestones) if (m.month < n) byMonth.set(m.month, [...(byMonth.get(m.month) ?? []), m]);
  const start = s.saved;
  return (
    <div className="cf-b-strip-wrap">
      <div className="cf-b-strip-nav">
        <button type="button" className="cf-icon-btn" aria-label="Mês anterior" disabled={s.sel === 0} onClick={() => s.setSel(s.sel - 1)}>
          <Icon name="left" />
        </button>
        <button type="button" className="cf-icon-btn" aria-label="Próximo mês" disabled={s.sel >= n - 1} onClick={() => s.setSel(s.sel + 1)}>
          <Icon name="right" />
        </button>
      </div>
      <div className="cf-b-strip" tabIndex={0} role="group" aria-label="Estações mês a mês. Setas trocam de mês." onKeyDown={monthKeys(s.sel, s.setSel, n)}>
        <article className="cf-b-station is-start">
          <span className="cf-b-node" aria-hidden />
          <h3>Hoje</h3>
          <p>Ponto de partida</p>
          <dl>
            <div>
              <dt>Em conta</dt>
              <dd>{fmt(start.startBalance)}</dd>
            </div>
            {start.goals.map((g) => (
              <div key={g.id}>
                <dt>{g.name}</dt>
                <dd>{fmt(g.saved)}</dd>
              </div>
            ))}
            <div>
              <dt>Dívidas</dt>
              <dd>{fmt(start.debts.reduce((a, d) => a + d.balance, 0))}</dd>
            </div>
          </dl>
        </article>
        {s.pD.rows.slice(0, n).map((r) => {
          const ev = byMonth.get(r.i) ?? [];
          const active = r.i === s.sel;
          return (
            <article key={r.i} className="cf-b-station" data-month={r.i} data-active={active || undefined} data-expand={(active && expand) || undefined} data-tight={r.free < 0 || undefined} data-passed={r.i < s.sel || undefined}>
              <span className="cf-b-node" aria-hidden>
                {ev.length ? <Icon name={ev.some((e) => e.missed) ? "alert" : "flag"} size={12} /> : null}
              </span>
              <button type="button" className="cf-b-station-head" aria-pressed={active} onClick={() => s.setSel(r.i)}>
                <span className="cf-b-mon">{monthName(r.i)}</span>
                <span className="cf-b-yr">{yearOf(r.i)}</span>
              </button>
              <p className="cf-b-free">
                {r.free < 0 ? "Falta " : "Folga "}
                <Money v={Math.abs(r.free)} />
              </p>
              {ev.length ? (
                <ul className="cf-b-events">
                  {ev.map((m) => (
                    <li key={m.id} data-kind={m.kind} data-missed={m.missed || undefined}>
                      {onEvent ? (
                        <button
                          type="button"
                          aria-pressed={focus === m.id}
                          onClick={() => {
                            s.setSel(r.i);
                            onEvent(m.id);
                          }}
                        >
                          {m.short}
                        </button>
                      ) : (
                        m.short
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="cf-b-quiet">{r.free < 0 ? "Mês apertado" : "Mês de constância"}</p>
              )}
              {active && expand ? <StationDetail i={r.i} events={ev} /> : null}
            </article>
          );
        })}
        <article className="cf-b-station is-end">
          <span className="cf-b-node" aria-hidden />
          <p>
            Depois de {monthShort(n - 1)}, aumente o horizonte para ver mais.
          </p>
        </article>
      </div>
    </div>
  );
}

function StationDetail({ i, events }: { i: number; events: Milestone[] }) {
  const s = useCopilot();
  const reserve = s.draft.goals.find((g) => g.kind === "reserva");
  const debtA = [...s.draft.debts].sort((a, b) => b.balance - a.balance)[0];
  return (
    <div className="cf-b-detail">
      {events.map((m) => (
        <div key={m.id} className="cf-b-why" data-missed={m.missed || undefined}>
          <h4>{m.title}</h4>
          <ul>
            {m.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ))}
      <MonthLedger i={i} plan={s.draft} pr={s.pD} compareTo={s.dirty ? s.pS : undefined} />
      <div className="cf-b-boost">
        <h4>Acelerar a partir de agora</h4>
        {debtA ? (
          <MoneyStepper
            compact
            label={`Extra na ${debtA.name}`}
            value={debtA.extra}
            step={100}
            onChange={(v) => s.setDraft((p) => ({ ...p, debts: p.debts.map((d) => (d.id === debtA.id ? { ...d, extra: v } : d)) }))}
          />
        ) : null}
        {reserve ? (
          <MoneyStepper
            compact
            label="Aporte na reserva"
            value={reserve.contribution}
            step={50}
            onChange={(v) => s.setDraft((p) => ({ ...p, goals: p.goals.map((g) => (g.id === reserve.id ? { ...g, contribution: v } : g)) }))}
          />
        ) : null}
      </div>
    </div>
  );
}
