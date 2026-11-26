"use client";
import { Select } from "../ds/select.tsx";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  compare,
  decisions,
  describeChanges,
  fmt,
  fmtSigned,
  INITIAL_PLAN,
  monthLong,
  monthShort,
  PREMISES,
  project,
  samePlan,
  suggestContribution,
  viability,
  WHAT_IFS as WHAT_IFS_VIEW,
  DEBT_KIND_LABEL,
  type Debt,
  type DebtKind,
  type Goal,
  type GoalKind,
  type Plan,
  type Projection,
} from "./engine.ts";

// ================================================================ estado

export type Area = "futuro" | "dividas" | "objetivos" | "simular";
export type Horizon = 3 | 6 | 12 | 24;

type Store = {
  saved: Plan;
  draft: Plan;
  pS: Projection;
  pD: Projection;
  dirty: boolean;
  changes: string[];
  setDraft: (fn: (p: Plan) => Plan) => void;
  save: () => void;
  restore: () => void;
  reset: () => void;
  commit: (fn: (p: Plan) => Plan) => void;
  horizon: Horizon;
  setHorizon: (h: Horizon) => void;
  sel: number;
  setSel: (i: number) => void;
  area: Area;
  setArea: (a: Area) => void;
  lastSavedAt: number;
};

const Ctx = createContext<Store | null>(null);

export function CopilotProvider({ children }: { children: ReactNode }) {
  const [saved, setSaved] = useState<Plan>(INITIAL_PLAN);
  const [draft, setDraftState] = useState<Plan>(INITIAL_PLAN);
  const [horizon, setHorizonState] = useState<Horizon>(12);
  const [sel, setSelState] = useState(0);
  const [area, setArea] = useState<Area>("futuro");
  const [lastSavedAt, setLastSavedAt] = useState(0);
  const pS = useMemo(() => project(saved), [saved]);
  const pD = useMemo(() => project(draft), [draft]);
  const dirty = !samePlan(saved, draft);
  const changes = useMemo(() => (dirty ? describeChanges(saved, draft) : []), [dirty, saved, draft]);
  const setDraft = useCallback((fn: (p: Plan) => Plan) => setDraftState((p) => fn(p)), []);
  const setHorizon = useCallback((h: Horizon) => {
    setHorizonState(h);
    setSelState((s) => Math.min(s, h - 1));
  }, []);
  const setSel = useCallback((i: number) => setSelState(Math.max(0, i)), []);
  const value: Store = {
    saved,
    draft,
    pS,
    pD,
    dirty,
    changes,
    setDraft,
    save: () => {
      setSaved(draft);
      setLastSavedAt(Date.now());
    },
    restore: () => setDraftState(saved),
    reset: () => {
      setSaved(INITIAL_PLAN);
      setDraftState(INITIAL_PLAN);
    },
    // cadastro confirmado: entra no plano real e na simulação aberta
    commit: (fn) => {
      setSaved((p) => fn(p));
      setDraftState((p) => fn(p));
      setLastSavedAt(Date.now());
    },
    horizon,
    setHorizon,
    sel: Math.min(sel, horizon - 1),
    setSel,
    area,
    setArea,
    lastSavedAt,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCopilot() {
  const s = useContext(Ctx);
  if (!s) throw new Error("CopilotProvider ausente");
  return s;
}

export function useDerived() {
  const s = useCopilot();
  return useMemo(
    () => ({
      diff: s.dirty ? compare(s.pS, s.draft, s.pD, s.horizon) : [],
      viab: viability(s.draft, s.pD, s.horizon),
      viabSaved: viability(s.saved, s.pS, s.horizon),
      decisions: decisions(s.saved, s.pS),
    }),
    [s.dirty, s.pS, s.pD, s.draft, s.saved, s.horizon],
  );
}

// ================================================================ motion

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);

/** Interpola um vetor de números até o novo alvo (morfa curvas e posições, sem fade). */
export function useTween(target: number[], ms = 420): number[] {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const key = target.join(",");
  useEffect(() => {
    const from = shownRef.current;
    const to = target;
    if (reduced || from.length === 0) {
      shownRef.current = to;
      setShown(to);
      return;
    }
    const pad = (xs: number[], n: number) =>
      xs.length >= n ? xs.slice(0, n) : [...xs, ...Array(n - xs.length).fill(xs[xs.length - 1] ?? 0)];
    const f = pad(from, to.length);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = easeOut(t);
      const v = to.map((x, i) => f[i] + (x - f[i]) * e);
      shownRef.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, reduced, ms]);
  return shown;
}

export function useTweenNumber(v: number, ms = 320) {
  return useTween([v], ms)[0];
}

/** true por ~1s depois que `v` muda: a interface marca o que mudou. */
export function useChanged(v: unknown) {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  const key = JSON.stringify(v);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setOn(true);
    const t = setTimeout(() => setOn(false), 1100);
    return () => clearTimeout(t);
  }, [key]);
  return on;
}

export function Money({ v, signed, className }: { v: number; signed?: boolean; className?: string }) {
  const shown = useTweenNumber(v);
  const changed = useChanged(Math.round(v));
  return (
    <span className={"cf-money " + (className ?? "")} data-changed={changed || undefined}>
      {signed ? fmtSigned(shown) : fmt(shown)}
    </span>
  );
}

export function ChangedText({ value, className }: { value: string; className?: string }) {
  const changed = useChanged(value);
  return (
    <span className={"cf-changed " + (className ?? "")} data-changed={changed || undefined}>
      {value}
    </span>
  );
}

// ================================================================ ícones (SVG autoral, traço 1.75)

const PATHS: Record<string, string> = {
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  left: "M15 5l-7 7 7 7",
  right: "M9 5l7 7-7 7",
  undo: "M9 7H5V3M5.3 7A8 8 0 1 1 4 12",
  flag: "M5 21V4m0 0h11l-2 4 2 4H5",
  sun: "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m0-11.4L4.9 4.9m14.2 14.2-1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z",
  info: "M12 11v6m0-10v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  pause: "M9 5v14M15 5v14",
  play: "M7 5l12 7-12 7V5Z",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  alert: "M12 9v4m0 4v.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  spark: "M12 3v4m0 10v4M3 12h4m10 0h4",
  layers: "M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
};

export function Icon({ name, size = 18, title }: { name: keyof typeof PATHS | string; size?: number; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      className="cf-icon"
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

// ================================================================ controles

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={"cf-seg " + (className ?? "")}
      style={{ ["--n" as string]: options.length, ["--i" as string]: idx }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const n = (idx + (e.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
        onChange(options[n].value);
        (ref.current?.querySelectorAll("button")[n] as HTMLButtonElement | undefined)?.focus();
      }}
    >
      <span className="cf-seg-thumb" aria-hidden />
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function HorizonSwitch({ className }: { className?: string }) {
  const { horizon, setHorizon } = useCopilot();
  return (
    <Segmented
      label="Horizonte da projeção"
      className={className}
      value={horizon}
      onChange={setHorizon}
      options={[
        { value: 3, label: "3m" },
        { value: 6, label: "6m" },
        { value: 12, label: "12m" },
        { value: 24, label: "24m" },
      ]}
    />
  );
}

export function MoneyStepper({
  label,
  value,
  onChange,
  step = 50,
  min = 0,
  max = 99999,
  hint,
  compact,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: ReactNode;
  compact?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  return (
    <div className={"cf-stepper" + (compact ? " is-compact" : "")}>
      <label htmlFor={id}>{label}</label>
      <div className="cf-stepper-row">
        <button type="button" aria-label={`Diminuir ${label} em ${fmt(step)}`} onClick={() => onChange(clamp(value - step))} disabled={value <= min}>
          <Icon name="minus" />
        </button>
        <span className="cf-stepper-field">
          <span aria-hidden>R$</span>
          <input
            id={id}
            inputMode="numeric"
            value={text}
            onChange={(e) => {
              const raw = e.target.value.replace(/\D/g, "");
              setText(raw);
              if (raw !== "") onChange(clamp(Number(raw)));
            }}
            onBlur={() => setText(String(value))}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                onChange(clamp(value + step));
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                onChange(clamp(value - step));
              }
            }}
          />
        </span>
        <button type="button" aria-label={`Aumentar ${label} em ${fmt(step)}`} onClick={() => onChange(clamp(value + step))} disabled={value >= max}>
          <Icon name="plus" />
        </button>
      </div>
      {hint ? <p className="cf-stepper-hint">{hint}</p> : null}
    </div>
  );
}

/** Painel lateral (desktop) / folha inferior (mobile) sobre <dialog>: foco e Esc nativos. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={"cf-sheet " + (className ?? "")}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="cf-sheet-body">
        <header className="cf-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="cf-icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </header>
        {open ? children : null}
      </div>
    </dialog>
  );
}

// ================================================================ leitura de um mês

export function MonthLedger({ i, plan, pr, compareTo }: { i: number; plan: Plan; pr: Projection; compareTo?: Projection }) {
  const r = pr.rows[i];
  const c = compareTo?.rows[i];
  const line = (label: string, v: number, cv?: number, strong?: boolean) => (
    <div className={"cf-ledger-line" + (strong ? " is-strong" : "")}>
      <dt>{label}</dt>
      <dd>
        <Money v={v} />
        {cv !== undefined && Math.round(cv) !== Math.round(v) ? <s className="cf-was">{fmt(cv)}</s> : null}
      </dd>
    </div>
  );
  const debtNames = plan.debts.filter((d) => r.debtPay[d.id] > 0);
  const goalNames = plan.goals.filter((g) => r.goalIn[g.id] > 0);
  return (
    <div className="cf-ledger">
      <dl className="cf-ledger-flow" aria-label={`Fluxo de ${monthLong(i)}`}>
        {line("Depois de essenciais e contas fixas", r.preCard)}
        {line("Fatura do cartão", -r.card, c ? -c.card : undefined)}
        {r.shockOut ? line("Imprevistos simulados", -r.shockOut, c ? -c.shockOut : undefined) : null}
        {debtNames.map((d) => (
          <div key={d.id}>{line(d.name, -r.debtPay[d.id], c ? -(c.debtPay[d.id] ?? 0) : undefined)}</div>
        ))}
        {goalNames.map((g) => (
          <div key={g.id}>{line(`Aporte · ${g.name}`, -r.goalIn[g.id], c ? -(c.goalIn[g.id] ?? 0) : undefined)}</div>
        ))}
        {line(r.free < 0 ? "Falta no mês" : "Folga livre", r.free, c?.free, true)}
      </dl>
      <dl className="cf-ledger-stock" aria-label={`Posição ao fim de ${monthLong(i)}`}>
        {line("Saldo em conta", r.bank, c?.bank)}
        {line("Guardado em objetivos", r.reserves, c?.reserves)}
        {line("Dívidas restantes", r.debtTotal, c?.debtTotal)}
        {line("Patrimônio (escopo do app)", r.netWorth, c?.netWorth, true)}
      </dl>
      {r.free < 0 ? (
        <p className="cf-note is-warn">
          <Icon name="alert" size={16} /> {fmt(-r.free)} saem do saldo em conta. A reserva não é usada automaticamente.
        </p>
      ) : null}
    </div>
  );
}

export function Premises({ className }: { className?: string }) {
  return (
    <details className={"cf-premises " + (className ?? "")}>
      <summary>
        <Icon name="info" size={16} /> Premissas do cálculo
      </summary>
      <ul>
        {PREMISES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </details>
  );
}

// ================================================================ simulação: o que mudou, comparação, salvar

export function ScenarioDock({ variant = "bar" }: { variant?: "bar" | "panel" }) {
  const s = useCopilot();
  const { diff, viab } = useDerived();
  const [confirm, setConfirm] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!s.dirty) setConfirm(false);
  }, [s.dirty]);
  useEffect(() => {
    if (!s.lastSavedAt) return;
    setJustSaved(true);
    const t = setTimeout(() => setJustSaved(false), 2600);
    return () => clearTimeout(t);
  }, [s.lastSavedAt]);
  if (!s.dirty) {
    return justSaved ? (
      <div className={"cf-dock is-" + variant + " is-saved"} role="status">
        <Icon name="check" /> Plano atualizado. A projeção agora parte dele.
      </div>
    ) : variant === "panel" ? (
      <div className={"cf-dock is-panel is-empty"}>
        <p>Nenhuma alteração. Mude um valor para comparar com o plano atual.</p>
      </div>
    ) : null;
  }
  return (
    <section className={"cf-dock is-" + variant} aria-label="Simulação em andamento" aria-live="polite">
      <div className="cf-dock-head">
        <span className="cf-sim-tag">Simulação · nada foi aplicado</span>
        <span className={"cf-viab is-" + viab.level}>
          <Icon name={viab.level === "ok" ? "check" : "alert"} size={15} /> {viab.title}
        </span>
      </div>
      <ul className="cf-dock-changes" aria-label="O que foi alterado">
        {s.changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {variant === "bar" && !expanded && diff.length ? (
        <ul className="cf-dock-top" aria-label="Principais efeitos">
          {diff.slice(0, 2).map((d) => (
            <li key={d.id} data-sense={d.sense > 0 ? "up" : d.sense < 0 ? "down" : "flat"}>
              <span>{d.label}</span> {d.before} → <strong>{d.after}</strong>
            </li>
          ))}
          <li>
            <button type="button" className="cf-dock-more" aria-expanded={false} onClick={() => setExpanded(true)}>
              Comparar tudo ({diff.length})
            </button>
          </li>
        </ul>
      ) : diff.length ? (
        <table className="cf-diff">
          <caption className="cf-sr">Antes e depois</caption>
          <thead>
            <tr>
              <th scope="col">Efeito</th>
              <th scope="col">Plano</th>
              <th scope="col">Simulação</th>
            </tr>
          </thead>
          <tbody>
            {diff.map((d) => (
              <tr key={d.id} data-sense={d.sense > 0 ? "up" : d.sense < 0 ? "down" : "flat"}>
                <th scope="row">{d.label}</th>
                <td>{d.before}</td>
                <td>
                  <strong>{d.after}</strong>
                  {d.delta ? (
                    <small>
                      {d.sense > 0 ? "melhora" : d.sense < 0 ? "piora" : ""} {d.delta}
                    </small>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="cf-dock-none">Essa mudança não altera datas nem saldos no horizonte.</p>
      )}
      {viab.level !== "ok" && (variant === "panel" || expanded) ? <p className="cf-dock-viab">{viab.detail}</p> : null}
      <div className="cf-dock-actions">
        {variant === "bar" && expanded ? (
          <button type="button" className="cf-btn is-quiet" aria-expanded onClick={() => setExpanded(false)}>
            <Icon name="down" size={16} /> Recolher
          </button>
        ) : null}
        <button type="button" className="cf-btn is-quiet" onClick={s.restore}>
          <Icon name="undo" size={16} /> Restaurar plano
        </button>
        {confirm ? (
          <span className="cf-confirm" role="group" aria-label="Confirmar novo plano">
            <span>Isso muda o plano real.</span>
            <button type="button" className="cf-btn is-quiet" onClick={() => setConfirm(false)}>
              Voltar
            </button>
            <button type="button" className="cf-btn is-primary" onClick={s.save}>
              Confirmar
            </button>
          </span>
        ) : (
          <button type="button" className="cf-btn is-primary" onClick={() => setConfirm(true)}>
            Salvar como plano
          </button>
        )}
      </div>
    </section>
  );
}

export function WhatIfs({ className, onApplied }: { className?: string; onApplied?: () => void }) {
  const s = useCopilot();
  return (
    <ul className={"cf-whatifs " + (className ?? "")} aria-label="Experimentar cenários">
      {WHAT_IFS_VIEW.map((w) => {
        const why = w.blocked(s.draft);
        return (
          <li key={w.id}>
            <button
              type="button"
              disabled={!!why}
              title={why ?? undefined}
              onClick={() => {
                s.setDraft(w.apply);
                onApplied?.();
              }}
            >
              <span>E se… {w.label.charAt(0).toLowerCase() + w.label.slice(1)}?</span>
              {why ? <small>{why}</small> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ================================================================ próximas decisões

export function DecisionList({ className, onArea }: { className?: string; onArea?: (a: Area) => void }) {
  const s = useCopilot();
  const { decisions: list } = useDerived();
  const [open, setOpen] = useState<string | null>(list[0]?.id ?? null);
  return (
    <ol className={"cf-decisions " + (className ?? "")}>
      {list.map((d) => {
        const isOpen = open === d.id;
        return (
          <li key={d.id} data-tone={d.tone} data-open={isOpen || undefined}>
            <button type="button" className="cf-decision-title" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
              <span className="cf-decision-mark" aria-hidden />
              <span>{d.title}</span>
              <Icon name={isOpen ? "up" : "down"} size={16} />
            </button>
            <div className="cf-decision-body" hidden={!isOpen}>
              <p className="cf-calc">{d.calc}</p>
              <p>{d.impact}</p>
              {d.action ? (
                <button
                  type="button"
                  className="cf-btn is-line"
                  onClick={() => {
                    if (d.action?.area) {
                      s.setArea(d.action.area);
                      onArea?.(d.action.area);
                    } else {
                      s.setDraft(d.action!.apply);
                      onArea?.("simular");
                    }
                  }}
                >
                  {d.action.label} <Icon name="right" size={16} />
                </button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ================================================================ dívidas

function DebtStair({ debt, pr, prev, months }: { debt: Debt; pr: Projection; prev?: Projection; months: number }) {
  const w = 280;
  const h = 72;
  const n = Math.min(months, pr.rows.length);
  const vals = [debt.balance, ...pr.rows.slice(0, n).map((r) => r.debtBal[debt.id] ?? 0)];
  const pv = prev ? [debt.balance, ...prev.rows.slice(0, n).map((r) => r.debtBal[debt.id] ?? 0)] : null;
  const tw = useTween(vals);
  const x = (k: number) => (k / n) * w;
  const y = (v: number) => h - 4 - (v / Math.max(debt.balance, 1)) * (h - 8);
  const path = (vs: number[]) => vs.map((v, k) => (k === 0 ? `M0 ${y(v)}` : `H${x(k)} V${y(v)}`)).join(" ");
  return (
    <svg className="cf-stair" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`Saldo devedor da ${debt.name} mês a mês`}>
      {pv ? <path d={path(pv)} className="cf-stair-prev" /> : null}
      <path d={path(tw) + ` V${h} H0 Z`} className="cf-stair-fill" />
      <path d={path(tw)} className="cf-stair-line" />
    </svg>
  );
}

export function DebtsArea({ className }: { className?: string }) {
  const s = useCopilot();
  const [selId, setSelId] = useState(s.draft.debts[0]?.id ?? "");
  const [adding, setAdding] = useState(false);
  const d = s.draft.debts.find((x) => x.id === selId) ?? s.draft.debts[0];
  const saved = s.saved.debts.find((x) => x.id === d?.id);
  const months = 24;
  return (
    <div className={"cf-debts " + (className ?? "")}>
      <div className="cf-debts-list" role="list">
        {s.draft.debts.map((x) => {
          const at = s.pD.payoff[x.id];
          return (
            <button
              key={x.id}
              type="button"
              role="listitem"
              className="cf-debt-row"
              aria-current={x.id === d?.id || undefined}
              onClick={() => setSelId(x.id)}
            >
              <span className="cf-debt-row-name">
                {x.name}
                <small>
                  {DEBT_KIND_LABEL[x.kind]} · vence dia {x.dueDay}
                </small>
              </span>
              <span className="cf-debt-row-val">
                {fmt(x.balance)}
                <small>quita {at === null ? "depois do horizonte" : at < 0 ? "já" : monthShort(at)}</small>
              </span>
            </button>
          );
        })}
        <button type="button" className="cf-btn is-line cf-debt-add" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} /> Cadastrar dívida
        </button>
      </div>
      {d ? (
        <article className="cf-debt-detail" aria-label={`Detalhe da ${d.name}`}>
          <header>
            <h3>{d.name}</h3>
            <p>
              {DEBT_KIND_LABEL[d.kind]} · vencimento todo dia {d.dueDay} · prioridade {[...s.draft.debts].sort((a, b) => a.priority - b.priority).findIndex((x) => x.id === d.id) + 1} de {s.draft.debts.length}
            </p>
          </header>
          <div className="cf-debt-facts">
            <div>
              <span>Saldo devedor</span>
              <strong>{fmt(d.balance)}</strong>
            </div>
            <div>
              <span>Quitação</span>
              <strong>
                <ChangedText value={s.pD.payoff[d.id] === null ? "fora do horizonte" : monthShort(s.pD.payoff[d.id]!)} />
              </strong>
              {saved && s.pS.payoff[d.id] !== s.pD.payoff[d.id] ? <s className="cf-was">{s.pS.payoff[d.id] === null ? "fora" : monthShort(s.pS.payoff[d.id]!)}</s> : null}
            </div>
            <div>
              <span>Redução do principal</span>
              <strong>{fmt(d.balance)}</strong>
            </div>
            <div>
              <span>Total pago</span>
              <strong>
                <Money v={s.pD.totals[d.id]?.paid ?? 0} />
              </strong>
              <small>{d.rate === null ? "igual ao principal com 0% (premissa)" : `inclui ${fmt(s.pD.totals[d.id]?.interest ?? 0)} de juros`}</small>
            </div>
          </div>
          <DebtStair debt={d} pr={s.pD} prev={s.dirty ? s.pS : undefined} months={months} />
          <p className="cf-axis-note">
            {monthShort(0)} → {monthShort(months - 1)} · degraus = pagamentos mensais
            {s.dirty ? " · tracejado = plano atual" : ""}
          </p>
          <div className="cf-debt-controls">
            <MoneyStepper
              label="Pagamento adicional por mês"
              value={d.extra}
              step={50}
              onChange={(v) => s.setDraft((p) => setDebtLocal(p, d.id, { extra: v }))}
              hint={
                <>
                  Pagamento planejado: {fmt(d.payment)}. Folga de {monthShort(0)}: <Money v={s.pD.rows[0].free} />
                </>
              }
            />
            <RateField debt={d} onChange={(rate) => s.setDraft((p) => setDebtLocal(p, d.id, { rate }))} />
            <div className="cf-prio">
              <span>Ordem para receber valor liberado</span>
              <div>
                <button
                  type="button"
                  className="cf-btn is-quiet"
                  onClick={() => s.setDraft((p) => ({ ...p, debts: p.debts.map((x) => ({ ...x, priority: x.id === d.id ? 0 : x.priority + 1 })) }))}
                >
                  <Icon name="up" size={16} /> Priorizar esta
                </button>
                <label className="cf-check">
                  <input type="checkbox" checked={s.draft.snowball} onChange={(e) => s.setDraft((p) => ({ ...p, snowball: e.target.checked }))} />
                  Ao quitar, o valor segue para a próxima
                </label>
              </div>
            </div>
          </div>
          {s.pD.neverPays.includes(d.id) ? (
            <p className="cf-note is-danger">
              <Icon name="alert" size={16} /> O pagamento não cobre os juros do mês: o saldo não diminui.
            </p>
          ) : null}
        </article>
      ) : null}
      <Sheet open={adding} onClose={() => setAdding(false)} title="Cadastrar dívida">
        <DebtForm
          onDone={(debt) => {
            s.commit((p) => ({ ...p, debts: [...p.debts, { ...debt, priority: p.debts.length + 1 }] }));
            setSelId(debt.id);
            setAdding(false);
          }}
        />
      </Sheet>
    </div>
  );
}

const setDebtLocal = (p: Plan, id: string, patch: Partial<Debt>): Plan => ({
  ...p,
  debts: p.debts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
});

function RateField({ debt, onChange }: { debt: Debt; onChange: (r: number | null) => void }) {
  const id = useId();
  const [text, setText] = useState(debt.rate === null ? "" : String(debt.rate).replace(".", ","));
  useEffect(() => setText(debt.rate === null ? "" : String(debt.rate).replace(".", ",")), [debt.rate, debt.id]);
  return (
    <div className="cf-field">
      <label htmlFor={id}>Juros ao mês (se souber)</label>
      <div className="cf-field-row">
        <input
          id={id}
          inputMode="decimal"
          placeholder="não informado"
          value={text}
          onChange={(e) => {
            const t = e.target.value.replace(/[^\d,.]/g, "");
            setText(t);
            const n = Number(t.replace(",", "."));
            onChange(t === "" || Number.isNaN(n) ? null : n);
          }}
        />
        <span>%</span>
      </div>
      <p className="cf-stepper-hint">Vazio = 0% na conta, sinalizado como premissa.</p>
    </div>
  );
}

function DebtForm({ onDone }: { onDone: (d: Debt) => void }) {
  const [name, setName] = useState("");
  const [balance, setBalance] = useState(1000);
  const [payment, setPayment] = useState(100);
  const [kind, setKind] = useState<DebtKind>("parcelado");
  const [dueDay, setDueDay] = useState(15);
  const [rate, setRate] = useState<number | null>(null);
  const months = payment > 0 ? Math.ceil(balance / payment) : null;
  return (
    <form
      className="cf-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim() || balance <= 0 || payment <= 0) return;
        onDone({ id: "d" + Date.now(), name: name.trim(), balance, payment, extra: 0, rate, dueDay, kind, priority: 9 });
      }}
    >
      <div className="cf-field">
        <label htmlFor="debt-name">Nome</label>
        <input id="debt-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Empréstimo do carro" required />
      </div>
      <fieldset className="cf-field">
        <legend>Tipo</legend>
        <div className="cf-chips">
          {(Object.keys(DEBT_KIND_LABEL) as DebtKind[]).map((k) => (
            <label key={k} className="cf-chip">
              <input type="radio" name="debt-kind" checked={kind === k} onChange={() => setKind(k)} />
              {DEBT_KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>
      <MoneyStepper label="Saldo devedor hoje" value={balance} onChange={setBalance} step={100} min={0} />
      <MoneyStepper label="Pagamento mensal" value={payment} onChange={setPayment} step={50} min={0} />
      <RateField debt={{ id: "new", name, balance, payment, extra: 0, rate, dueDay, kind, priority: 0 }} onChange={setRate} />
      <div className="cf-field">
        <label htmlFor="debt-due">Dia do vencimento</label>
        <input id="debt-due" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(Math.max(1, Math.min(31, Number(e.target.value) || 1)))} />
      </div>
      <p className="cf-form-preview">
        {months
          ? `${months} pagamento${months > 1 ? "s" : ""} até quitar${rate ? ", antes dos juros" : ""}. O pagamento sai da verba de ${fmt(1600)}.`
          : "Informe um pagamento para estimar a quitação."}
      </p>
      <button type="submit" className="cf-btn is-primary" disabled={!name.trim()}>
        Cadastrar no plano
      </button>
    </form>
  );
}

// ================================================================ objetivos

export function GoalsArea({ className, onNew }: { className?: string; onNew?: () => void }) {
  const s = useCopilot();
  const [wizard, setWizard] = useState(false);
  return (
    <div className={"cf-goals " + (className ?? "")}>
      {[...s.draft.goals]
        .sort((a, b) => a.priority - b.priority)
        .map((g) => (
          <GoalRow key={g.id} goal={g} />
        ))}
      <button
        type="button"
        className="cf-btn is-line cf-goal-add"
        onClick={() => {
          setWizard(true);
          onNew?.();
        }}
      >
        <Icon name="plus" size={16} /> Novo objetivo
      </button>
      <GoalWizard open={wizard} onClose={() => setWizard(false)} />
    </div>
  );
}

function GoalRow({ goal: g }: { goal: Goal }) {
  const s = useCopilot();
  const at = s.pD.reach[g.id];
  const atSaved = s.pS.reach[g.id];
  const bal = s.pD.rows[s.sel].goalBal[g.id] ?? g.saved;
  const paused = !!g.adjust && g.adjust.amount === 0;
  const kindLabel = g.kind === "reserva" ? "Reserva de emergência" : g.kind === "data" ? `Até ${g.due !== null ? monthLong(g.due) : "—"}` : "Sem prazo";
  return (
    <article className="cf-goal" aria-label={g.name}>
      <header>
        <h3>{g.name}</h3>
        <p>{kindLabel}</p>
      </header>
      <GoalCells goal={g} value={bal} />
      <p className="cf-goal-status">
        {fmt(g.saved)} hoje · {g.target !== null ? `meta ${fmt(g.target)}` : "sem valor-alvo"} ·{" "}
        {g.target === null ? (
          <>
            em {monthShort(s.sel)}: <Money v={bal} />
          </>
        ) : at === null ? (
          "não completa no horizonte"
        ) : (
          <>
            completa em <ChangedText value={monthShort(at)} />
          </>
        )}
        {atSaved !== at && atSaved !== undefined ? <s className="cf-was">{atSaved === null ? "fora do horizonte" : monthShort(atSaved)}</s> : null}
      </p>
      <div className="cf-goal-controls">
        <MoneyStepper
          compact
          label="Aporte mensal"
          value={g.contribution}
          step={50}
          onChange={(v) => s.setDraft((p) => ({ ...p, goals: p.goals.map((x) => (x.id === g.id ? { ...x, contribution: v } : x)) }))}
          hint={g.kind === "data" && g.due !== null ? `Para chegar na data: ${fmt(suggestContribution(g))}/mês` : undefined}
        />
        <button
          type="button"
          className="cf-btn is-quiet"
          aria-pressed={paused}
          disabled={g.contribution === 0}
          onClick={() =>
            s.setDraft((p) => ({
              ...p,
              goals: p.goals.map((x) => (x.id === g.id ? { ...x, adjust: paused ? null : { from: 1, months: 3, amount: 0 } } : x)),
            }))
          }
        >
          <Icon name={paused ? "play" : "pause"} size={16} /> {paused ? "Retomar aportes" : `Pausar 3 meses (${monthShort(1)}–${monthShort(3)})`}
        </button>
      </div>
    </article>
  );
}

/** Progresso em células de valor fixo (cada célula = 1/10 da meta, valor exato no rótulo). */
export function GoalCells({ goal, value }: { goal: Goal; value: number }) {
  if (goal.target === null) {
    return (
      <p className="cf-goal-open">
        <Money v={value} /> guardados, sem meta: cada aporte conta.
      </p>
    );
  }
  const cell = goal.target / 10;
  const full = Math.floor(value / cell + 1e-6);
  const part = Math.min(1, value / cell - full);
  return (
    <div className="cf-cells" role="img" aria-label={`${fmt(value)} de ${fmt(goal.target)}. Cada bloco vale ${fmt(cell)}.`}>
      {Array.from({ length: 10 }, (_, k) => (
        <span key={k} className="cf-cell" style={{ ["--fill" as string]: k < full ? 1 : k === full ? part : 0 }} />
      ))}
      <small aria-hidden>cada bloco = {fmt(cell)}</small>
    </div>
  );
}

export function GoalWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Novo objetivo">
      <WizardBody onClose={onClose} />
    </Sheet>
  );
}

function WizardBody({ onClose }: { onClose: () => void }) {
  const s = useCopilot();
  const hasReserve = s.saved.goals.some((g) => g.kind === "reserva");
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<GoalKind>("data");
  const [name, setName] = useState("");
  const [target, setTarget] = useState<number | null>(3000);
  const [saved, setSaved] = useState(0);
  const [due, setDue] = useState<number>(11);
  const freeNow = s.pS.rows[0].free;
  const proposal = useMemo(() => {
    if (kind === "data" && target !== null) return suggestContribution({ saved, target, due });
    if (kind === "reserva" && target !== null) return Math.max(0, Math.min(Math.max(freeNow, 0), Math.ceil((target - saved) / 12)));
    return Math.max(0, Math.min(100, freeNow));
  }, [kind, target, saved, due, freeNow]);
  const [contribution, setContribution] = useState<number | null>(null);
  const contrib = contribution ?? proposal;
  const goal: Goal = {
    id: "new-goal",
    name: name.trim() || (kind === "reserva" ? "Reserva de emergência" : "Novo objetivo"),
    kind,
    saved,
    target: kind === "aberto" ? target : target ?? 0,
    contribution: contrib,
    due: kind === "data" ? due : null,
    priority: s.saved.goals.length + 1,
    adjust: null,
  };
  const withGoal: Plan = { ...s.saved, goals: [...s.saved.goals, goal] };
  const pr = useMemo(() => project(withGoal), [JSON.stringify(withGoal)]);
  const diff = compare(s.pS, withGoal, pr, 24).filter((d) => d.id !== "g-new-goal");
  const viab = viability(withGoal, pr);
  const reach = pr.reach["new-goal"];
  const steps = ["O quê", "Quanto", "Aporte", "Impacto"];
  const canNext = step === 0 ? kind !== "reserva" || !hasReserve : step === 1 ? kind === "aberto" || (target ?? 0) > saved : true;
  return (
    <div className="cf-wizard">
      <ol className="cf-wizard-steps" aria-label="Etapas">
        {steps.map((t, k) => (
          <li key={t} aria-current={k === step ? "step" : undefined} data-done={k < step || undefined}>
            {t}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <div className="cf-wizard-pane">
          <fieldset className="cf-field">
            <legend>O que vocês querem conquistar?</legend>
            <div className="cf-kinds">
              {(
                [
                  ["reserva", "Reserva de emergência", hasReserve ? "Vocês já têm uma reserva" : "Segurança para meses ruins"],
                  ["data", "Algo com data", "Viagem, compra, evento"],
                  ["aberto", "Juntar sem prazo", "Contribuir quando der"],
                ] as const
              ).map(([k, t, sub]) => (
                <label key={k} className="cf-kind" data-disabled={(k === "reserva" && hasReserve) || undefined}>
                  <input type="radio" name="goal-kind" checked={kind === k} disabled={k === "reserva" && hasReserve} onChange={() => setKind(k)} />
                  <strong>{t}</strong>
                  <small>{sub}</small>
                </label>
              ))}
            </div>
          </fieldset>
          {kind !== "reserva" ? (
            <div className="cf-field">
              <label htmlFor="goal-name">Nome</label>
              <input id="goal-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === "data" ? "Ex.: Notebook novo" : "Ex.: Bicicleta"} />
            </div>
          ) : null}
        </div>
      ) : null}
      {step === 1 ? (
        <div className="cf-wizard-pane">
          {kind === "reserva" ? (
            <div className="cf-field">
              <span className="cf-label">Meta a partir das despesas essenciais ({fmt(s.saved.essentials)}/mês)</span>
              <div className="cf-chips">
                {[3, 4, 6].map((m) => (
                  <button key={m} type="button" className="cf-chip" aria-pressed={target === s.saved.essentials * m} onClick={() => setTarget(s.saved.essentials * m)}>
                    {m} meses · {fmt(s.saved.essentials * m)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {kind === "aberto" ? (
            <label className="cf-check">
              <input type="checkbox" checked={target === null} onChange={(e) => setTarget(e.target.checked ? null : 3000)} /> Sem valor-alvo
            </label>
          ) : null}
          {target !== null ? <MoneyStepper label="Valor-alvo" value={target} onChange={setTarget} step={100} /> : null}
          <MoneyStepper label="Já guardado" value={saved} onChange={setSaved} step={100} />
          {kind === "data" ? (
            <div className="cf-field">
              <label htmlFor="goal-due">Para quando?</label>
              <Select id="goal-due" value={due} onChange={(e) => setDue(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, k) => (
                  <option key={k} value={k}>
                    {monthLong(k)}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}
      {step === 2 ? (
        <div className="cf-wizard-pane">
          <p className="cf-proposal">
            {kind === "data" && target !== null
              ? `Para juntar ${fmt(target - saved)} até ${monthShort(due)}: ${fmt(target - saved)} ÷ ${due + 1} meses = ${fmt(proposal)}/mês.`
              : kind === "reserva" && target !== null
                ? `Proposta: ${fmt(proposal)}/mês, limitada à folga livre de ${fmt(freeNow)}.`
                : `Proposta leve: ${fmt(proposal)}/mês. Pode ajustar quando quiser.`}
          </p>
          <MoneyStepper label="Aporte mensal" value={contrib} onChange={setContribution} step={10} />
          <div className="cf-source">
            <span>De onde vem</span>
            <p>
              Folga livre de {monthShort(0)}: <strong>{fmt(freeNow)}</strong> → <strong>{fmt(freeNow - contrib)}</strong>
            </p>
            {freeNow - contrib < 0 ? (
              <p className="cf-note is-warn">
                <Icon name="alert" size={16} /> Passa da folga em {fmt(contrib - freeNow)}. Para caber, reduza outro aporte ou o valor deste.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="cf-wizard-pane">
          <p className="cf-proposal">
            {goal.name}:{" "}
            {goal.target === null
              ? `${fmt(contrib)}/mês, sem data de conclusão.`
              : reach === null
                ? "não completa nos próximos 36 meses com esse aporte."
                : `completa em ${monthLong(reach)}${kind === "data" ? (reach <= due ? ", dentro da data" : `, ${reach - due} meses depois da data`) : ""}.`}
          </p>
          <div className={"cf-viab is-" + viab.level}>
            <Icon name={viab.level === "ok" ? "check" : "alert"} size={15} /> {viab.title}
          </div>
          {diff.length ? (
            <ul className="cf-impact">
              {diff.map((d) => (
                <li key={d.id} data-sense={d.sense > 0 ? "up" : d.sense < 0 ? "down" : "flat"}>
                  <span>{d.label}</span>
                  <span>
                    {d.before} → <strong>{d.after}</strong>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Os outros objetivos e dívidas não mudam de data.</p>
          )}
        </div>
      ) : null}
      <div className="cf-wizard-nav">
        {step > 0 ? (
          <button type="button" className="cf-btn is-quiet" onClick={() => setStep(step - 1)}>
            <Icon name="left" size={16} /> Voltar
          </button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <button type="button" className="cf-btn is-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Continuar <Icon name="right" size={16} />
          </button>
        ) : (
          <button
            type="button"
            className="cf-btn is-primary"
            onClick={() => {
              s.commit((p) => ({ ...p, goals: [...p.goals, { ...goal, id: "g" + Date.now() }] }));
              onClose();
            }}
          >
            <Icon name="check" size={16} /> Criar objetivo
          </button>
        )}
      </div>
    </div>
  );
}

// ================================================================ util de gráfico

export function scale(d0: number, d1: number, r0: number, r1: number) {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Curva suave monotônica (Catmull-Rom limitado) para séries financeiras. */
export function smoothPath(pts: [number, number][]) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]} ${pts[0][1]}` : "";
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    let c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    let c2y = p2[1] - (p3[1] - p1[1]) * t;
    const lo = Math.min(p1[1], p2[1]);
    const hi = Math.max(p1[1], p2[1]);
    c1y = Math.max(lo, Math.min(hi, c1y));
    c2y = Math.max(lo, Math.min(hi, c2y));
    d += ` C${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

export function useElementWidth<T extends HTMLElement>(fallback = 900) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Setas ←/→ navegam meses quando o foco está no contêiner. */
export function monthKeys(sel: number, setSel: (i: number) => void, max: number) {
  return (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setSel(Math.min(max - 1, sel + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      setSel(Math.max(0, sel - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setSel(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setSel(max - 1);
    }
  };
}
