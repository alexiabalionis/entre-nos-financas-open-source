"use client";
import { Select } from "../ds/select.tsx";
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  contributionMonths,
  lastCountedMonth,
  monthLong,
  monthShort,
  neededMonthly,
  type Decision,
  type Scenario,
} from "../../src/domain/future-months.ts";
import { AmountStepper, Button, DiffList, DisclosureButton, Icon, IconButton, Segmented, type IconName } from "../ds/index.ts";
import { Collapse } from "../ds/collapse.tsx";
import { cx } from "../ds/shared.ts";
import { formatCents, fromReais, maskMoney, toApiAmount, toReais } from "../lib/cents.ts";
import { api } from "../lib/api.ts";
import { useTweenNumber } from "../ds/use-motion.ts";
import { ContributionControl } from "./contribution-control.tsx";
import { EverydayControl } from "./everyday-control.tsx";
import { useFutureContext } from "./future-context.tsx";
import { useDismissed } from "./use-dismissed.ts";
import { MonthNote, useMonthNotes } from "./month-note.tsx";
import { useRouter } from "next/navigation";
import { handToJudite } from "../chat/handoff.ts";
import { partsText, purchaseParts, verdictOf, type History, type Part, type Verdict } from "./simulator-verdict.ts";
import { floor50, ladder, roomFor, shortMonths } from "../../src/domain/sobra.ts";
import {
  SIMULATED_PURCHASE,
  diffRows,
  plannedMonthly,
  installmentLabel,
  purchaseDayOptions,
  reachText,
} from "./view-model.ts";

type Kind = "purchase" | "goal" | "suggestions" | "everyday";

/** O que costuma sobrar (Panorama). Null enquanto carrega ou sem mês fechado: aí o plano decide sozinho. */
const HistoryContext = createContext<History | null>(null);

/** Soma dos aportes que já estão no plano salvo para o mês, menos o de um objetivo (o que está sendo refeito). */
function plannedTotal(goals: { id: string; plans: { month: string; planned: bigint }[]; status: string }[], month: string, except?: string) {
  return goals
    .filter((g) => g.status === "active" && g.id !== except)
    .reduce((sum, g) => sum + plannedMonthly(g.plans, month), 0n);
}

/** Parcelas oferecidas: as mais comuns, numa linha só (cabe no celular com alvo de 44px). */
const TIMES = [1, 2, 3, 6, 10, 12] as const;

const TITLES: Record<Kind, string> = {
  purchase: "Dá pra comprar isso?",
  goal: "Quanto guardar para um objetivo?",
  suggestions: "O que o plano sugere?",
  everyday: "E se o dia a dia mudar?",
};

/**
 * A aba Simular: uma pergunta por vez. A tela abre com as perguntas; escolher
 * uma abre uma folha (celular) ou um painel no centro (desktop) com a resposta
 * no topo, colada no controle. A resposta é o veredito do motor ("Cabe.",
 * "Fica apertado.", "Não cabe.") e o porquê em uma frase.
 *
 * Regras que não mudam: só aportes viram plano, e só com "Confirmar"; compra e
 * dia a dia são simulação. Fechar uma pergunta limpa o que não pode virar
 * plano; um aporte em teste fica guardado e aparece como "Teste em aberto".
 */
export function Simulator({ onCommitted }: { onCommitted?: () => void } = {}) {
  const f = useFutureContext();
  const goals = (f.draftInput?.goals ?? []).filter((g) => g.status === "active");
  // Todas as sugestões do motor (avisos também), menos as escondidas com "agora não".
  const dismissed = useDismissed(!f.reader);
  // A sobra dos meses fechados vem junto com o plano (a mesma do Panorama).
  const history = f.input?.signals?.history ?? null;
  const all = f.base?.decisions ?? [];
  const suggestions = all.filter((d) => !dismissed.hidden(d));
  const hiddenCount = all.length - suggestions.length;
  const hasCards = (f.input?.cards.length ?? 0) > 0;
  const hasEveryday = f.input?.everyday.weekly != null;
  const [open, setOpen] = useState<Kind | null>(null);
  const [last, setLast] = useState<Kind | null>(null);
  const [saved, setSaved] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const ask = (kind: Kind) => {
    // Uma pergunta por vez: trocar de pergunta começa do plano salvo. Um rascunho
    // trazido da aba Futuro (ainda sem pergunta aqui) é mantido.
    if (f.dirty && last !== null && kind !== last) f.discard();
    setSaved(false);
    setLast(kind);
    setOpen(kind);
  };
  const close = () => {
    if (f.dirty && !f.canSave) f.discard();
    setOpen(null);
  };

  const doors: { kind: Kind; icon: IconName; sub: string; count?: number }[] = [
    ...(hasCards ? [{ kind: "purchase" as const, icon: "card" as const, sub: "Digitem o valor e as parcelas: a resposta diz se o mês aguenta." }] : []),
    ...(goals.length ? [{ kind: "goal" as const, icon: "flag" as const, sub: "Quanto por mês e quando ele completa." }] : []),
    ...(suggestions.length
      ? [{ kind: "suggestions" as const, icon: "spark" as const, sub: maskMoney(suggestions[0].title, f.hidden), count: suggestions.length }]
      : []),
  ];

  const handleSaved = () => {
    setSaved(true);
    setOpen(null);
    onCommitted?.();
  };

  return (
    <HistoryContext.Provider value={history}>
    <div className="fut-sim grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-6">
        <header className="fut-sim-head">
          <h2 className="fut-sim-title">O que vocês querem saber?</h2>
          <p className="fut-sim-lede">Escolham uma pergunta. Nada é gravado até vocês confirmarem.</p>
        </header>

        {saved ? (
          <p className="fut-sim-status" role="status">
            <Icon name="check" size={16} /> Plano salvo. O Futuro já está contando com isso.
          </p>
        ) : null}

        {f.dirty && f.canSave && (!open || !isDesktop) ? (
          <div className="fut-sim-pending" role="status">
            <span className="fut-sim-pending-text">
              <strong>Teste em aberto</strong>
              <span>{maskMoney(f.describe[0] ?? "Uma mudança ainda não salva.", f.hidden)}</span>
            </span>
            <span className="fut-sim-pending-actions">
              <Button variant="quiet" size="sm" onClick={f.discard}>
                Descartar
              </Button>
              <Button size="sm" onClick={() => setOpen(last ?? "goal")}>
                Continuar
              </Button>
            </span>
          </div>
        ) : null}

        {doors.length ? (
          <ul className="fut-sim-doors">
            {doors.map((d) => {
              const selected = isDesktop && open === d.kind;
              return (
                <li key={d.kind}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    className={cx(
                      "fut-sim-door transition-colors",
                      selected && "border-accent! bg-accent-soft/50! ring-1 ring-accent",
                    )}
                    onClick={() => ask(d.kind)}
                  >
                    <span className="fut-sim-door-icon" aria-hidden>
                      <Icon name={d.icon} size={20} />
                    </span>
                    <span className="fut-sim-door-text">
                      <span className="fut-sim-door-title">
                        {TITLES[d.kind]}
                        {d.count ? <span className="fut-sim-door-count">{d.count}</span> : null}
                      </span>
                      <span className="fut-sim-door-sub">{d.sub}</span>
                    </span>
                    <Icon name="right" size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ds-caption">
            Cadastrem um objetivo ou um cartão para simular. Sem eles, ainda não há o que testar aqui.
          </p>
        )}

        {hasEveryday ? (
          <p className="fut-sim-other">
            <Button variant="text" onClick={() => ask("everyday")}>
              Outra coisa: mudar o gasto do dia a dia
            </Button>
          </p>
        ) : null}
      </div>

      <div className="hidden min-w-0 lg:block">
        {open ? (
          <section
            key={open}
            aria-label={TITLES[open]}
            className="rounded-2xl border border-border bg-surface p-6"
          >
            <header className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-3">
              <h3 className="text-[1.0625rem] font-semibold tracking-tight text-ink">
                {TITLES[open]}
              </h3>
              <IconButton icon="close" label="Fechar" onClick={close} />
            </header>
            <QuestionBody
              kind={open}
              suggestions={suggestions}
              hiddenCount={hiddenCount}
              onDismiss={dismissed.dismiss}
              onRestore={dismissed.restore}
              onSaved={handleSaved}
              onDone={close}
            />
          </section>
        ) : (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border-strong bg-surface p-8 text-center">
            <p className="font-display text-lg font-medium text-ink">
              Escolha uma pergunta ao lado
            </p>
            <p className="mt-1.5 max-w-sm text-[0.875rem] leading-relaxed text-ink-2">
              Você vê o impacto mês a mês e decide depois se quer gravar no plano.
            </p>
          </div>
        )}
      </div>

      <QuestionDialog open={!isDesktop && open !== null} title={open ? TITLES[open] : ""} onClose={close}>
        {open ? (
          <QuestionBody
            kind={open}
            suggestions={suggestions}
            hiddenCount={hiddenCount}
            onDismiss={dismissed.dismiss}
            onRestore={dismissed.restore}
            onSaved={handleSaved}
            onDone={close}
          />
        ) : null}
      </QuestionDialog>
    </div>
    </HistoryContext.Provider>
  );
}

/** Folha de baixo no celular, painel no centro a partir de 640px (native dialog). */
function QuestionDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="fixed inset-0 z-50 m-0 hidden h-dvh max-h-none w-screen max-w-none items-end justify-center bg-transparent p-0 text-ink backdrop:bg-black/45 backdrop:backdrop-blur-[2px] sm:items-center sm:p-4 open:flex"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open ? (
        <div className="fut-sim-sheet flex max-h-[90dvh] w-full flex-col overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 pb-0 text-ink shadow-xl sm:max-w-xl sm:rounded-2xl">
          <span className="fut-sim-grab" aria-hidden />
          <header className="fut-sim-sheet-head">
            {/* Foco inicial no título (não no Fechar): o leitor de tela ouve a pergunta e o anel não pesa. */}
            <h2 id={titleId} className="fut-sim-sheet-title" tabIndex={-1} autoFocus>
              {title}
            </h2>
            <IconButton icon="close" label="Fechar" onClick={onClose} />
          </header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

/** Conteúdo de uma pergunta: veredito no topo, controle logo abaixo, ações no fim. */
function QuestionBody({
  kind,
  suggestions,
  hiddenCount,
  onDismiss,
  onRestore,
  onSaved,
  onDone,
}: {
  kind: Kind;
  suggestions: Decision[];
  hiddenCount: number;
  onDismiss: (d: Decision) => void;
  onRestore: () => void;
  onSaved: () => void;
  onDone: () => void;
}) {
  if (kind === "goal") return <GoalQuestion onSaved={onSaved} onDone={onDone} />;
  return <OtherQuestion kind={kind} suggestions={suggestions} hiddenCount={hiddenCount} onDismiss={onDismiss} onRestore={onRestore} onSaved={onSaved} onDone={onDone} />;
}

function OtherQuestion({
  kind,
  suggestions,
  hiddenCount,
  onDismiss,
  onRestore,
  onSaved,
  onDone,
}: {
  kind: Kind;
  suggestions: Decision[];
  hiddenCount: number;
  onDismiss: (d: Decision) => void;
  onRestore: () => void;
  onSaved: () => void;
  onDone: () => void;
}) {
  const f = useFutureContext();
  const goals = (f.draftInput?.goals ?? []).filter((g) => g.status === "active");
  const [goalId, setGoalId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [active, setActive] = useState<Decision | null>(null);
  const goal = goals.find((g) => g.id === goalId) ?? goals[0];
  const months = f.months;

  const purchase = f.scenario.purchases?.find((p) => p.label === SIMULATED_PURCHASE);
  const lead: Part[] | string =
    kind === "purchase" && purchase
      ? purchaseParts(purchase.cents, purchase.installments)
      : kind === "goal" && goal && f.draft
        ? // "Primeira reserva completa em ago/27." (o nome à frente: com dois objetivos, qual?)
          reachText(f.draft, goal.id).replace(/^(Completa|Não completa)/, (m) => `${goal.name} ${m.toLowerCase()}`)
        : f.describe[0]
          ? `${maskMoney(f.describe[0], f.hidden)}.`
          : "";
  // Compromisso novo por mês, para comparar com o que costuma sobrar: a parcela
  // da compra (à vista: o valor inteiro, num mês só) ou o quanto os aportes do
  // rascunho passam do que já está no plano.
  const history = useContext(HistoryContext);
  const saved = f.input?.goals ?? [];
  const commit =
    kind === "purchase" && purchase
      ? purchase.installments === 1
        ? purchase.cents
        : ((purchase.cents + BigInt(purchase.installments) * 100n - 1n) / (BigInt(purchase.installments) * 100n)) * 100n
      : (f.scenario.contributions ?? []).reduce((sum, c) => {
          const g = saved.find((x) => x.id === c.goalId);
          const more = c.cents - (g ? plannedMonthly(g.plans, c.fromMonth) : 0n);
          return more > 0n ? sum + more : sum;
        }, 0n) -
        // Dinheiro que a fatura deixa de cobrar não é compromisso novo: só o que
        // passar dele precisa caber no que costuma sobrar.
        (kind === "suggestions" && f.dirty && active?.edit?.kind === "freed" ? active.edit.cents : 0n);
  const nextMonth = f.input ? addMonths(f.input.startMonth, 1) : "";
  const planned = plannedTotal(saved, nextMonth);
  // Três tipos de simulação, cada um com a sua resposta:
  // - liberar: a fatura cai e o dinheiro ganha destino (nunca "não cabe");
  // - gastar: uma compra, contra o que costuma sobrar;
  // - guardar: um aporte novo, contra o que costuma sobrar.
  const freed = kind === "suggestions" && active?.edit?.kind === "freed" ? active.edit : null;
  const sim: "liberar" | "gastar" | "guardar" = kind === "purchase" ? "gastar" : freed && commit <= 0n ? "liberar" : "guardar";
  const verdict: Verdict | null =
    !(f.dirty && f.base && f.draft)
      ? null
      : sim === "liberar" && freed
        ? freedVerdict(freed.cents, freed.fromMonth, f.scenario.contributions ?? [], saved, f.draft, f.hidden)
        : verdictOf(
            f.base,
            f.draft,
            months,
            lead,
            f.hidden,
            history && commit > 0n ? { commit, history, planned } : undefined,
          );

  // "E se…": só quando aperta, e só com histórico para dizer quanto teria faltado.
  const alternatives: Alternative[] = [];
  let altNote: string | null = null;
  if (verdict && verdict.level !== "ok" && history && commit > 0n) {
    const total = history.kept.length;
    const now = shortMonths(history, planned, commit).length;
    const room = roomFor(history, planned);
    if (sim === "gastar" && purchase) {
      for (const t of TIMES) {
        if (t <= purchase.installments) continue;
        const each = ceilReal(purchase.cents, t);
        const short = shortMonths(history, planned, each).length;
        if (each > room && commit <= room) continue;
        if (short >= now && !(commit > room && each <= room)) continue;
        alternatives.push({
          key: `x${t}`,
          label: `Em ${t}x de ${formatCents(each, f.hidden)}`,
          detail: shortDetail(short, total),
          pick: () => f.patch({ purchases: [{ ...purchase, installments: t }] }),
        });
        if (alternatives.length === 3) break;
      }
      // Acima da média: a maior compra que fica dentro dela, nas mesmas parcelas.
      if (commit > room && room > 0n) {
        const max = (room * BigInt(purchase.installments)) / 10000n * 10000n;
        if (max > 0n)
          alternatives.push({
            key: "max",
            label: `Uma compra de até ${formatCents(max, f.hidden)} em ${purchase.installments}x`,
            detail: shortDetail(shortMonths(history, planned, ceilReal(max, purchase.installments)).length, total),
            pick: () => f.patch({ purchases: [{ ...purchase, cents: max }] }),
          });
      }
    }
    const c = (f.scenario.contributions ?? []).find((x) => {
      const g = saved.find((y) => y.id === x.goalId);
      return x.cents > (g ? plannedMonthly(g.plans, x.fromMonth) : 0n);
    });
    if (sim === "guardar" && c) {
      const g = saved.find((y) => y.id === c.goalId);
      const base = g ? plannedMonthly(g.plans, c.fromMonth) : 0n;
      const missing = g && g.target > g.saved ? g.target - g.saved : 0n;
      for (const step of ladder(history, planned, commit)) {
        const per = base + step.cents;
        const n = missing > 0n ? Number((missing + per - 1n) / per) : 0;
        alternatives.push({
          key: `m${step.cents}`,
          label: `${formatCents(per, f.hidden)} por mês${n > 0 ? `, completa em ${monthShort(addMonths(c.fromMonth, n - 1))}` : ""}`,
          detail: shortDetail(step.short, total),
          pick: () => f.replace({ contributions: [{ ...c, cents: per }] }),
        });
      }
    }
    altNote = negativeNote(history, planned, commit, alternatives.length);
  }
  const simulationOnly = kind === "purchase" || kind === "everyday" || (kind === "suggestions" && !f.canSave);

  return (
    <div className="fut-sim-sheet-body">
      <VerdictBlock
        verdict={verdict}
        empty={
          kind === "suggestions"
            ? "Escolham uma sugestão e toquem em Ajustar e testar: a resposta aparece aqui."
            : "Mudem o valor e a resposta aparece aqui."
        }
        note={simulationOnly ? "Só simulação: compras e dia a dia não viram plano." : undefined}
      >
        <Alternatives options={alternatives} note={altNote} verdict={verdict} />
      </VerdictBlock>

      {kind === "purchase" ? <PurchaseQuestion /> : null}
      {kind === "goal" && goal ? (
        <div className="fut-sim-controls">
          {goals.length > 1 ? (
            <Segmented
              label="Objetivo"
              size="sm"
              value={goal.id}
              options={goals.map((g) => ({ value: g.id, label: g.name }))}
              onChange={(id) => {
                // Uma pergunta por vez: trocar de objetivo descarta o teste do anterior,
                // para a resposta falar só do objetivo que está na tela.
                if (f.dirty) f.discard();
                setGoalId(id);
              }}
            />
          ) : null}
          <ContributionControl key={goal.id} goalId={goal.id} />
        </div>
      ) : null}
      {kind === "everyday" ? (
        <div className="fut-sim-controls">
          <EverydayControl />
        </div>
      ) : null}
      {kind === "suggestions" ? (
        <SuggestionList suggestions={suggestions} hiddenCount={hiddenCount} onDismiss={onDismiss} onRestore={onRestore} active={active} onActive={setActive} />
      ) : null}

      {f.dirty ? <Numbers purchase={kind === "purchase"} /> : null}

      {f.error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[0.875rem] text-danger"
        >
          {f.error}
        </p>
      ) : null}

      <footer className="fut-sim-sheet-foot">
        {f.canSave && confirming ? (
          <>
            <p className="fut-sim-confirm" role="status">
              Vai para o plano: <strong>{maskMoney(f.describe.join("; "), f.hidden)}</strong>. Os planos anteriores ficam no
              histórico.
            </p>
            <div className="fut-sim-actions">
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                Voltar
              </Button>
              <Button
                variant="primary"
                busy={f.saving}
                busyLabel="Salvando…"
                onClick={() =>
                  void f.save().then((ok) => {
                    setConfirming(false);
                    if (ok) onSaved();
                  })
                }
              >
                Confirmar
              </Button>
            </div>
          </>
        ) : (
          <div className="fut-sim-actions">
            {f.dirty ? (
              <Button variant="quiet" onClick={f.discard}>
                Limpar
              </Button>
            ) : null}
            {f.canSave ? (
              <Button variant="primary" onClick={() => setConfirming(true)}>
                Salvar como plano
              </Button>
            ) : (
              <Button variant="primary" onClick={onDone}>
                Pronto
              </Button>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}

/**
 * A resposta: a palavra grande, o porquê e, se for o caso, o aviso de que já era
 * assim. Os valores deslizam até o novo número; o leitor de tela ouve só a frase
 * final (região viva à parte), não cada quadro da animação.
 */
function VerdictBlock({
  verdict,
  empty,
  note,
  children,
}: {
  verdict: Verdict | null;
  empty: string;
  note?: string;
  children?: ReactNode;
}) {
  const f = useFutureContext();
  return (
    <section className="fut-sim-verdict" data-level={verdict?.level ?? "none"}>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {verdict ? `${verdict.word} ${verdict.line}` : ""}
      </p>
      {verdict ? (
        <div aria-hidden>
          <p className="fut-sim-verdict-word" key={verdict.level}>
            <Icon name={verdict.level === "ok" ? "check" : "alert"} size={22} />
            {verdict.word}
          </p>
          <p className="fut-sim-verdict-line">
            {verdict.parts.map((p, i) =>
              typeof p === "string" ? <span key={i}>{p}</span> : <TweenMoney key={i} cents={p.cents} hidden={f.hidden} />,
            )}
          </p>
        </div>
      ) : (
        <p className="fut-sim-verdict-empty">{empty}</p>
      )}
      {verdict?.before ? <p className="fut-sim-verdict-note">{verdict.before}</p> : null}
      {note && verdict ? <p className="fut-sim-verdict-note">{note}</p> : null}
      {verdict ? children : null}
    </section>
  );
}

export type Alternative = { key: string; label: string; detail: string; pick: () => void };

/**
 * "E se…": caminhos concretos quando fica apertado ou não cabe (menos por mês,
 * mais vezes, mais prazo), cada um com quantos meses fechados teriam faltado.
 * Tocar num deles testa na hora.
 */
function Alternatives({
  options,
  note,
  verdict,
}: {
  options: Alternative[];
  note?: string | null;
  verdict?: Verdict | null;
}) {
  const router = useRouter();
  const f = useFutureContext();
  const tight = verdict && verdict.level !== "ok";
  if (options.length === 0 && !note && !tight) return null;
  // A Judite recebe a resposta como pergunta pronta; a pessoa revisa e envia.
  const talk = () => {
    if (!verdict) return;
    handToJudite(`Simulei no Copiloto: ${verdict.word} ${verdict.line} Como sobrar mais para isso caber? Onde dá para cortar?`);
    router.push("/judite");
  };
  return (
    <div className="fut-sim-alts">
      <p className="fut-sim-alts-title">E se…</p>
      {note ? <p className="fut-sim-alts-note">{note}</p> : null}
      {tight && !f.reader ? (
        <Button variant="quiet" size="sm" className="w-auto! self-start" onClick={talk}>
          Conversar com a Judite sobre como sobrar mais
        </Button>
      ) : null}
      {options.length > 0 ? (
        <ul>
          {options.map((o) => (
            <li key={o.key}>
              <button type="button" className="fut-sim-alt" onClick={o.pick}>
                <span className="fut-sim-alt-label">{o.label}</span>
                <span className="fut-sim-alt-detail">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Quando nenhum valor menor ajuda: os meses que apertaram fecharam no
 * negativo, então qualquer compromisso novo teria faltado neles.
 */
function negativeNote(history: History, planned: bigint, commit: bigint, steps: number): string | null {
  if (steps > 0 || commit > roomFor(history, planned)) return null;
  const short = shortMonths(history, planned, commit);
  const negative = history.kept.filter((k) => k.cents - planned < 0n).map((k) => k.month);
  if (short.length === 0 || negative.length !== short.length) return null;
  const names = negative.map((m) => monthShort(m).split("/")[0]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}` : names[0];
  return `Nenhum valor menor muda isso: em ${list} a conta já fechou no negativo. O que muda a resposta é sobrar mais nesses meses.`;
}

/** "teria cabido em todos os meses" / "teria faltado em 2 dos 10 meses". */
function shortDetail(short: number, total: number): string {
  return short === 0 ? "teria cabido em todos os meses fechados" : `teria faltado em ${short} dos ${total} meses fechados`;
}

/** Valor que vai do número antigo ao novo (movimento reduzido: direto). */
function TweenMoney({ cents, hidden }: { cents: bigint; hidden: boolean }) {
  const shown = useTweenNumber(Number(cents), 420);
  return <span className="fut-sim-num">{formatCents(BigInt(Math.round(shown)), hidden)}</span>;
}

/** "Ver os números": antes → depois do motor e, na compra, a fatura mês a mês. Fechado por padrão. */
function Numbers({ purchase }: { purchase: boolean }) {
  const f = useFutureContext();
  const [open, setOpen] = useState(false);
  const id = useId();
  const months =
    purchase && f.base && f.draft
      ? f.draft.rows.slice(0, f.months).flatMap((r, i) => {
          const before = f.base!.rows[i];
          return before && before.card !== r.card ? [{ month: r.month, before: before.card, after: r.card, free: r.free }] : [];
        })
      : [];
  if (f.diff.length === 0 && months.length === 0) return null;
  return (
    <div className="fut-sim-numbers">
      <DisclosureButton
        className="fut-sim-link w-auto! min-h-10! justify-start! gap-1.5! border-0! px-0! py-1! shadow-none! hover:bg-transparent!"
        expanded={open}
        controls={id}
        onToggle={() => setOpen(!open)}
        iconSize={14}
      >
        <span>{open ? "Esconder os números" : purchase ? "Ver a fatura mês a mês" : "Ver os números"}</span>
      </DisclosureButton>
      <Collapse id={id} open={open}>
        {months.length ? (
          <table className="fut-sim-months">
            <thead>
              <tr>
                <th scope="col">Mês</th>
                <th scope="col">Fatura</th>
                <th scope="col">Sobra</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{monthShort(m.month)}</th>
                  <td>
                    <span className="fut-sim-was">{formatCents(m.before, f.hidden)}</span> → {formatCents(m.after, f.hidden)}
                  </td>
                  <td>{formatCents(m.free, f.hidden)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {f.diff.length ? <DiffList rows={diffRows(f.diff, f.hidden)} empty="Com essa mudança, nada muda no horizonte." /> : null}
      </Collapse>
    </div>
  );
}

/** Compra parcelada: valor, parcelas, cartão e quando. Entra no rascunho ao abrir. */
function PurchaseQuestion() {
  const f = useFutureContext();
  const id = useId();
  const input = f.input;
  const current = f.scenario.purchases?.find((p) => p.label === SIMULATED_PURCHASE);
  // Os controles seguem o rascunho: uma alternativa ("Em 10x") também move os chips.
  const [valueState, setValue] = useState(current ? Number(current.cents / 100n) : 1800);
  const [timesState, setTimes] = useState(current?.installments ?? 6);
  const value = current ? Number(current.cents / 100n) : valueState;
  const times = current?.installments ?? timesState;
  const [card, setCard] = useState<string | null>(current?.card ?? null);
  const [day, setDay] = useState<string | null>(current?.day ?? null);
  const chosenCard = card ?? input?.cards[0]?.card ?? "";
  const chosenDay = day ?? input?.today ?? "";
  const apply = (next: { value?: number; times?: number; card?: string; day?: string } = {}) =>
    f.patch({
      purchases: [
        {
          card: next.card ?? chosenCard,
          cents: fromReais(next.value ?? value),
          installments: next.times ?? times,
          day: next.day ?? chosenDay,
          label: SIMULATED_PURCHASE,
        },
      ],
    });
  // A pergunta já abre com a resposta: a compra padrão entra no rascunho.
  const applied = useRef(!!current);
  useEffect(() => {
    if (applied.current || !input || !chosenCard) return;
    applied.current = true;
    apply();
  });
  if (!input || input.cards.length === 0) return null;

  return (
    <div className="fut-sim-controls">
      <AmountStepper
        hidden={f.hidden}
        label="Valor da compra"
        value={value}
        step={100}
        min={100}
        onChange={(v) => {
          setValue(v);
          apply({ value: v });
        }}
      />
      <fieldset className="fut-sim-chips">
        <legend>Em quantas vezes</legend>
        <div role="radiogroup" aria-label="Em quantas vezes" className="grid grid-cols-6 gap-1.5">
          {TIMES.map((t) => {
            const active = t === times;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                className={cx(
                  "ui-reset-btn inline-flex min-h-9.5 items-center justify-center rounded-xl border text-[0.875rem] font-semibold tabular-nums transition-colors",
                  active
                    ? "border-accent bg-accent text-white"
                    : "border-border bg-surface text-ink hover:bg-surface-2",
                )}
                onClick={() => {
                  setTimes(t);
                  apply({ times: t });
                }}
              >
                {t}x
              </button>
            );
          })}
        </div>
        <p className="fut-sim-hint">{installmentLabel(value, times, f.hidden)}</p>
      </fieldset>
      <div className="fut-sim-selects">
        {input.cards.length > 1 ? (
          <div className="fut-field">
            <label htmlFor={`${id}-card`}>Cartão</label>
            <Select
              id={`${id}-card`}
              value={chosenCard}
              onChange={(e) => {
                setCard(e.target.value);
                apply({ card: e.target.value });
              }}
            >
              {input.cards.map((c) => (
                <option key={c.card} value={c.card}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="fut-field">
          <label htmlFor={`${id}-day`}>Quando</label>
          <Select
            id={`${id}-day`}
            value={chosenDay}
            onChange={(e) => {
              setDay(e.target.value);
              apply({ day: e.target.value });
            }}
          >
            {purchaseDayOptions(input).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

/**
 * Sugestões do motor. Cada uma diz o que viu (título) e a conta; dá para
 * ajustar o valor antes de testar (aporte num objetivo, ou para onde vai o que
 * a fatura libera), testar como está, ir até a categoria no Mês (avisos que não
 * simulam) ou esconder com "agora não" (volta quando o número muda 20%).
 */
function SuggestionList({
  suggestions,
  hiddenCount,
  onDismiss,
  onRestore,
  active,
  onActive,
}: {
  suggestions: Decision[];
  hiddenCount: number;
  onDismiss: (d: Decision) => void;
  onRestore: () => void;
  active: Decision | null;
  onActive: (d: Decision) => void;
}) {
  const f = useFutureContext();
  const goals = (f.input?.goals ?? []).filter((g) => g.status === "active");
  const notes = useMonthNotes(f.input?.startMonth ?? "");
  const test = (d: Decision) => {
    const e = d.edit;
    if (e?.kind === "contribution") {
      // Começa do valor sugerido; o ajuste logo abaixo troca o aporte.
      f.replace({ contributions: [{ goalId: e.goalId, fromMonth: e.fromMonth, months: null, cents: e.cents }] });
    } else if (e?.kind === "freed" && goals[0]) {
      // Começa pelo objetivo que mais falta, com o valor liberado até completar
      // (mais que o que falta o motor não usa); o resto fica livre.
      const missing = (x: (typeof goals)[number]) => (x.target > x.saved ? x.target - x.saved : 0n);
      const g = goals.reduce((a, b) => (missing(b) > missing(a) ? b : a));
      const cap = ((missing(g) + 4999n) / 5000n) * 5000n;
      const cents = e.cents < cap ? e.cents : cap;
      f.replace({ contributions: [{ goalId: g.id, fromMonth: e.fromMonth, months: null, cents: plannedMonthly(g.plans, e.fromMonth) + cents }] });
    } else if (d.action) {
      f.replace(d.action.scenario);
    } else return;
    onActive(d);
  };
  if (suggestions.length === 0)
    return (
      <div className="fut-sim-sugs-empty">
        <p className="fut-sim-verdict-empty">Nenhuma sugestão agora.</p>
        {hiddenCount > 0 && !f.reader ? (
          <Button variant="text" onClick={onRestore}>
            Mostrar as {hiddenCount} escondidas
          </Button>
        ) : null}
      </div>
    );
  return (
    <>
      <ul className="fut-sim-sugs">
        {suggestions.map((d) => {
          const on = active?.id === d.id && f.dirty;
          return (
            <li key={d.id} className="fut-sim-sug" data-on={on || undefined}>
              <div className="fut-sim-sug-text">
                <p className="fut-sim-sug-title">{maskMoney(d.title, f.hidden)}</p>
                <p className="fut-sim-sug-what">{maskMoney(d.calc, f.hidden)}</p>
                <p className="fut-sim-sug-what">{maskMoney(d.impact, f.hidden)}</p>
                {on && d.edit ? <SuggestionEdit decision={d} /> : null}
                {/* Avisos de categoria: dá para anotar o porquê deste mês. */}
                {categoryOf(d) ? (
                  <MonthNote
                    key={`${d.id}-${notes.notes.get(categoryOf(d)!) ?? ""}`}
                    name={categoryOf(d)!}
                    note={notes.notes.get(categoryOf(d)!)}
                    canWrite={!f.reader}
                    onSave={notes.save}
                  />
                ) : null}
                <div className="fut-sim-sug-actions">
                  {on ? (
                    <span className="fut-sim-sug-on">
                      <Icon name="check" size={16} /> Testando
                    </span>
                  ) : d.edit ? (
                    <Button variant="quiet" size="sm" onClick={() => test(d)}>
                      Ajustar e testar
                    </Button>
                  ) : d.action ? (
                    <Button variant="quiet" size="sm" onClick={() => test(d)}>
                      Testar
                    </Button>
                  ) : d.link ? (
                    <Link
                      className="inline-flex min-h-8.5 items-center rounded-xl bg-accent-soft px-3 text-[0.8125rem] font-medium text-accent-ink no-underline transition-colors hover:brightness-95"
                      href={d.link.href}
                    >
                      {d.link.label}
                    </Link>
                  ) : null}
                  {!f.reader ? (
                    <Button
                      variant="text"
                      size="sm"
                      onClick={() => {
                        if (on) f.discard();
                        onDismiss(d);
                      }}
                    >
                      Agora não
                    </Button>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {hiddenCount > 0 && !f.reader ? (
        <p className="fut-sim-hint">
          {hiddenCount === 1 ? "1 sugestão escondida." : `${hiddenCount} sugestões escondidas.`}{" "}
          <Button variant="text" size="sm" onClick={onRestore}>
            Mostrar de novo
          </Button>
        </p>
      ) : null}
    </>
  );
}

/** Nome da categoria de um aviso do mês ("passou do teto", "subiu"); null nos demais. */
function categoryOf(d: Decision): string | null {
  const m = /^(budget|rise)-(.+)$/.exec(d.id);
  return m ? m[2] : null;
}

/**
 * Ajuste de uma sugestão já em teste. Aporte: o valor por mês no objetivo.
 * Valor liberado pela fatura: qual objetivo recebe e quanto (o resto fica de
 * folga); soma ao aporte que o objetivo já tem naquele mês.
 */
function SuggestionEdit({ decision }: { decision: Decision }) {
  const f = useFutureContext();
  const edit = decision.edit!;
  const goals = (f.input?.goals ?? []).filter((g) => g.status === "active");
  // No valor liberado, o objetivo é o que o teste escolheu (o que mais falta).
  const tested = f.scenario.contributions?.find((c) => c.fromMonth === edit.fromMonth)?.goalId;
  const [goalId, setGoalId] = useState(edit.kind === "contribution" ? edit.goalId : (tested ?? goals[0]?.id ?? ""));
  const [reaisState, setReais] = useState(toReais(edit.cents));
  const goal = goals.find((g) => g.id === goalId);
  if (!goal) return null;
  const base = edit.kind === "freed" ? plannedMonthly(goal.plans, edit.fromMonth) : 0n;
  // Segue o rascunho: uma alternativa escolhida acima também move o valor aqui.
  const current = f.scenario.contributions?.find((c) => c.goalId === goalId && c.fromMonth === edit.fromMonth);
  const reais = current ? toReais(current.cents - base) : reaisState;
  const apply = (id: string, v: number) =>
    f.replace({ contributions: [{ goalId: id, fromMonth: edit.fromMonth, months: null, cents: base + fromReais(v) }] });
  // Aporte: no máximo o que falta para a meta (mais que isso o motor não usa).
  const toTarget = goal.target > goal.saved ? goal.target - goal.saved : 0n;
  const targetMax = Math.max(50, Math.ceil(toReais(toTarget) / 50) * 50);
  const freedMax = edit.kind === "freed" ? Math.min(toReais(edit.cents), targetMax) : targetMax;
  return (
    <div className="fut-sim-sug-edit">
      {edit.kind === "freed" && goals.length > 1 ? (
        <Segmented
          label="Para qual objetivo"
          size="sm"
          value={goalId}
          options={goals.map((g) => ({ value: g.id, label: g.name }))}
          onChange={(id) => {
            setGoalId(id);
            apply(id, reais);
          }}
        />
      ) : null}
      <AmountStepper
        hidden={f.hidden}
        compact
        label={
          edit.kind === "freed"
            ? `Quanto do valor liberado vai para ${goal.name} (a partir de ${monthShort(edit.fromMonth)})`
            : `Quanto por mês em ${goal.name}`
        }
        value={Math.min(reais, freedMax)}
        step={50}
        min={edit.kind === "freed" ? 0 : 50}
        {...(freedMax !== undefined ? { max: freedMax } : {})}
        onChange={(v) => {
          setReais(v);
          apply(goalId, v);
        }}
        hint={
          edit.kind === "freed" && reais < toReais(edit.cents)
            ? `${reais >= targetMax ? `Com isso ${goal.name} completa. ` : ""}O resto (${formatCents(edit.cents - fromReais(Math.min(reais, freedMax)), f.hidden)}) fica livre no mês.`
            : undefined
        }
      />
    </div>
  );
}

const NEW = "novo";
const NEW_ID = "novo-objetivo";

/** Último dia do mês "YYYY-MM" como "YYYY-MM-DD". */
function endOfMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
}
/** Parcela arredondada para cima no real inteiro (a mesma conta do rótulo das parcelas). */
function ceilReal(cents: bigint, times: number): bigint {
  const n = BigInt(times) * 100n;
  return ((cents + n - 1n) / n) * 100n;
}

/**
 * Resposta de "liberar": a fatura cai e o dinheiro ganha destino. Não há
 * "não cabe" (é dinheiro que deixa de sair); diz para onde vai e o que sobra.
 */
function freedVerdict(
  freed: bigint,
  from: string,
  contributions: NonNullable<Scenario["contributions"]>,
  goals: { id: string; name: string; plans: { month: string; planned: bigint }[] }[],
  draft: Parameters<typeof reachText>[0],
  hidden: boolean,
): Verdict {
  const c = contributions.find((x) => x.fromMonth === from);
  const g = c ? goals.find((x) => x.id === c.goalId) : undefined;
  const to = c && g ? c.cents - plannedMonthly(g.plans, from) : 0n;
  const rest = freed - (to > 0n ? to : 0n);
  const when = monthLong(from).split(" de ")[0];
  const parts: Part[] = ["A partir de ", when, ", a fatura cobra ", { cents: freed }, " a menos."];
  if (g && to > 0n) {
    // Completa já no primeiro mês: é um aporte só, não "por mês".
    if (draft.reach[g.id] === from) parts.push(" ", { cents: to }, ` vão para ${g.name}, que completa em ${monthShort(from)}.`);
    else {
      parts.push(" ", { cents: to }, ` por mês vão para ${g.name}`);
      const reach = reachText(draft, g.id).replace(/^Completa/, "completa").replace(/^Não completa/, "não completa");
      parts.push(reach ? `: ${reach}` : ".");
    }
  }
  if (rest > 0n) parts.push(" ", { cents: rest }, " ficam livres no mês.");
  const word = g && to > 0n ? (rest > 0n ? "Parte tem destino." : "Tudo tem destino.") : "Fica livre.";
  return { level: "ok", word, line: partsText(parts, hidden), parts };
}

/** "2026-12-15" → "15/12/2026". */
const ddmmyyyy = (d: string) => d.split("-").reverse().join("/");
function addMonths(m: string, n: number): string {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}

/**
 * "Quanto guardar para um objetivo?": vocês dizem qual objetivo (um que já
 * existe ou um novo), quanto imaginam precisar e até que dia. O motor calcula
 * quanto guardar por mês (o que falta ÷ aportes até a data, arredondado para
 * cima) e responde se cabe. Aportes começam no mês seguinte (o corrente não
 * conta) e um mês conta se termina até a data (contributionMonths). Salvar
 * grava a meta, o prazo (por mês, o último que conta) e o plano mensal, depois
 * de "Confirmar".
 */
function GoalQuestion({ onSaved, onDone }: { onSaved: () => void; onDone: () => void }) {
  const f = useFutureContext();
  const history = useContext(HistoryContext);
  const id = useId();
  const input = f.input;
  const goals = (input?.goals ?? []).filter((g) => g.status === "active");
  const start = input?.startMonth ?? "";
  const [pick, setPick] = useState<string>(goals[0]?.id ?? NEW);
  const goal = goals.find((g) => g.id === pick);
  const [name, setName] = useState("");
  const [targetReais, setTargetReais] = useState(goal ? toReais(goal.target) : 5000);
  // Prazo como dia. Um objetivo salvo tem prazo por mês: vira o último dia dele.
  const [deadline, setDeadline] = useState(
    goal?.deadlineMonth ? endOfMonth(goal.deadlineMonth) : start ? endOfMonth(addMonths(start, 12)) : "",
  );
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const saved = goal?.saved ?? 0n;
  const target = fromReais(targetReais);
  const n = start && deadline ? contributionMonths(start, deadline) : 0;
  const first = start ? addMonths(start, 1) : "";
  const lastMonth = deadline ? lastCountedMonth(deadline) : "";
  const need = n > 0 ? neededMonthly(target, saved, n) : 0n;
  const missing = target > saved ? target - saved : 0n;
  const label = goal ? goal.name : name.trim() || "o novo objetivo";

  // A cada mudança, o rascunho vira exatamente esta pergunta (uma por vez).
  const scenario: Scenario | null = !start
    ? null
    : goal
      ? {
          goalEdits: [{ goalId: goal.id, target, deadlineMonth: lastMonth }],
          ...(need > 0n ? { contributions: [{ goalId: goal.id, fromMonth: first, months: n, cents: need }] } : {}),
        }
      : {
          newGoals: [{ id: NEW_ID, name: name.trim() || "Novo objetivo", target, saved: 0n, deadlineMonth: lastMonth, monthly: 0n }],
          ...(need > 0n ? { contributions: [{ goalId: NEW_ID, fromMonth: first, months: n, cents: need }] } : {}),
        };
  const key = JSON.stringify(scenario, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  const scenarioRef = useRef(scenario);
  scenarioRef.current = scenario;
  useEffect(() => {
    if (scenarioRef.current) f.replace(scenarioRef.current);
    // A chave do cenário decide (f.replace muda a cada render).
  }, [key]);

  const choose = (next: string) => {
    setPick(next);
    setConfirming(false);
    const g = goals.find((x) => x.id === next);
    setTargetReais(g ? toReais(g.target) : 5000);
    setDeadline(g?.deadlineMonth ? endOfMonth(g.deadlineMonth) : endOfMonth(addMonths(start, 12)));
  };

  const span =
    n === 1 ? `um aporte, em ${monthLong(first).split(" de ")[0]}` : `${n} aportes, de ${monthShort(first)} a ${monthShort(lastMonth)}`;
  const lead: Part[] =
    missing === 0n
      ? [`${label.charAt(0).toUpperCase()}${label.slice(1)} já tem o valor: não precisa guardar mais.`]
      : ["Para juntar ", { cents: missing }, ` até ${ddmmyyyy(deadline)}, vocês precisam guardar `, { cents: need }, n === 1 ? ` (${span}).` : ` por mês (${span}).`];
  // Sem nenhum mês que termine até a data, não há aporte novo que chegue a tempo:
  // a resposta é honesta mesmo sem simular nada.
  const tooSoon = missing > 0n && n === 0;
  const verdict: Verdict | null = tooSoon
    ? {
        level: "inviavel",
        word: "Não dá tempo.",
        line: `Os aportes começam em ${monthLong(first)} e contam no fim de cada mês: até ${ddmmyyyy(deadline)} nenhum chega a tempo. Escolham uma data a partir de ${ddmmyyyy(endOfMonth(first))}.`,
        parts: [
          `Os aportes começam em ${monthLong(first)} e contam no fim de cada mês: até ${ddmmyyyy(deadline)} nenhum chega a tempo. Escolham uma data a partir de ${ddmmyyyy(endOfMonth(first))}.`,
        ],
      }
    : f.base && f.draft && f.dirty
      ? verdictOf(
          f.base,
          f.draft,
          f.months,
          lead,
          f.hidden,
          history && need > 0n
            ? { commit: need, history, planned: plannedTotal(goals, first, goal?.id) }
            : undefined,
        )
      : null;
  const canSave = !f.reader && !tooSoon && (goal !== undefined || name.trim().length > 0);

  // "E se…": com o que cabe melhor por mês, quando fecha (outra data) ou quanto
  // dá para juntar até a mesma data (outro valor).
  const alternatives: Alternative[] = [];
  let goalNote: string | null = null;
  if (verdict && verdict.level !== "ok" && !tooSoon && history && need > 0n) {
    const planned = plannedTotal(goals, first, goal?.id);
    const total = history.kept.length;
    for (const step of ladder(history, planned, need, 2)) {
      const months = Number((missing + step.cents - 1n) / step.cents);
      const end = addMonths(start, months);
      alternatives.push({
        key: `d${step.cents}`,
        label: `${formatCents(step.cents, f.hidden)} por mês, até ${monthShort(end)}`,
        detail: shortDetail(step.short, total),
        pick: () => setDeadline(endOfMonth(end)),
      });
    }
    const best = ladder(history, planned, need, 1)[0];
    if (best) {
      const reach = floor50(saved + best.cents * BigInt(n));
      if (reach > saved && reach < target)
        alternatives.push({
          key: "t",
          label: `Juntar ${formatCents(reach, f.hidden)} até ${ddmmyyyy(deadline)}`,
          detail: `${formatCents(best.cents, f.hidden)} por mês; ${shortDetail(best.short, total)}`,
          pick: () => setTargetReais(toReais(reach)),
        });
    }
    goalNote = negativeNote(history, planned, need, alternatives.length);
  }

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      let goalId = goal?.id;
      if (goal) {
        const list = await api<{ id: string; name: string; version: number }[]>("reserves");
        const current = list.find((g) => g.id === goal.id);
        if (!current) throw new Error("Objetivo não encontrado. Atualizem a página.");
        await api("reserves/update", {
          goal_id: goal.id,
          version: current.version,
          name: current.name,
          target: toApiAmount(target),
          deadline_month: lastMonth,
        });
      } else {
        goalId = (await api<{ id: string }>("reserves/create", { name: name.trim(), target: toApiAmount(target), deadline_month: lastMonth })).id;
      }
      if (goalId && need > 0n)
        await api("reserves/plan-range", { goal_id: goalId, from_month: first, months: Math.min(36, n), planned: toApiAmount(need) });
      f.discard();
      await f.reload();
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar o objetivo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fut-sim-sheet-body">
      <VerdictBlock verdict={verdict} empty="Digam quanto e até quando e a resposta aparece aqui.">
        <Alternatives options={alternatives} note={goalNote} verdict={verdict} />
      </VerdictBlock>

      <div className="fut-sim-controls">
        <Segmented
          label="Qual objetivo"
          size="sm"
          value={pick}
          options={[...goals.map((g) => ({ value: g.id, label: g.name })), { value: NEW, label: "Novo" }]}
          onChange={choose}
        />
        {!goal ? (
          <div className="fut-field">
            <label htmlFor={`${id}-name`}>Nome do objetivo</label>
            <input
              id={`${id}-name`}
              type="text"
              maxLength={80}
              placeholder="Ex.: Carro, Casamento, Reforma"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        ) : null}
        <AmountStepper
          hidden={f.hidden}
          label="Quanto vocês imaginam precisar"
          value={targetReais}
          step={100}
          min={100}
          onChange={(v) => {
            setTargetReais(v);
            setConfirming(false);
          }}
          hint={saved > 0n ? `Já guardado: ${formatCents(saved, f.hidden)}.` : undefined}
        />
        <div className="fut-field">
          <label htmlFor={`${id}-when`}>Até quando</label>
          <input
            id={`${id}-when`}
            type="date"
            value={deadline}
            min={start ? `${first}-01` : undefined}
            max={start ? endOfMonth(addMonths(start, 36)) : undefined}
            onChange={(e) => {
              if (!e.target.value) return;
              setDeadline(e.target.value);
              setConfirming(false);
            }}
          />
          <p className="fut-sim-hint">Os aportes começam em {monthLong(first)}; um mês conta se termina até a data.</p>
        </div>
      </div>

      {f.dirty ? <Numbers purchase={false} /> : null}

      {error || f.error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[0.875rem] text-danger"
        >
          {error || f.error}
        </p>
      ) : null}

      <footer className="fut-sim-sheet-foot">
        {canSave && confirming ? (
          <>
            <p className="fut-sim-confirm" role="status">
              Vai para o plano: <strong>{label}</strong>, meta de{" "}
              <strong>{formatCents(target, f.hidden)}</strong> até <strong>{ddmmyyyy(deadline)}</strong>
              {need > 0n ? (
                <>
                  , guardando <strong>{formatCents(need, f.hidden)}/mês</strong>
                </>
              ) : null}
              . Os planos anteriores ficam no histórico.
              {deadline !== endOfMonth(lastMonth) ? ` O prazo fica gravado como ${monthLong(lastMonth)}, o último mês que termina até ${ddmmyyyy(deadline)}.` : ""}
            </p>
            <div className="fut-sim-actions">
              <Button variant="quiet" onClick={() => setConfirming(false)}>
                Voltar
              </Button>
              <Button variant="primary" busy={busy} busyLabel="Salvando…" onClick={() => void save()}>
                Confirmar
              </Button>
            </div>
          </>
        ) : (
          <div className="fut-sim-actions">
            {canSave ? (
              <Button variant="primary" onClick={() => setConfirming(true)}>
                {goal ? "Salvar meta e plano" : "Criar objetivo e plano"}
              </Button>
            ) : (
              <Button variant="primary" onClick={onDone}>
                Pronto
              </Button>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
