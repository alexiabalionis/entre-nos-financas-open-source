"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "./button.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { cx } from "./shared.ts";

export type ProgressiveRevealProps<T> = {
  items: readonly T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: IconName;
  triggerLabel?: string;
  triggerHint?: ReactNode;
  analyzingSteps?: readonly string[];
  analyzeMs?: number;
  stepMs?: number;
  autoStart?: boolean;
  progressLabel?: (revealed: number, total: number) => string;
  doneMeta?: (total: number) => ReactNode;
  replayLabel?: string;
  footer?: ReactNode;
  emptyState?: ReactNode;
  resetKey?: string | number;
  className?: string;
  listClassName?: string;
};

type RevealPhase = "idle" | "analyzing" | "revealing" | "done";

const DEFAULT_STEPS = ["Analisando seus dados…"];

/**
 * Microinteração reutilizável: inicia sob demanda (ou ao montar quando `autoStart`),
 * simula análise breve e revela os itens progressivamente um a um.
 */
export function ProgressiveReveal<T>({
  items,
  getKey,
  renderItem,
  title,
  subtitle,
  icon = "sparkle",
  triggerLabel = "Analisar",
  triggerHint,
  analyzingSteps = DEFAULT_STEPS,
  analyzeMs = 1050,
  stepMs = 340,
  autoStart = false,
  progressLabel = (revealed, total) => `${revealed} de ${total}`,
  doneMeta = (total) => `${total} ${total === 1 ? "descoberta" : "descobertas"}`,
  replayLabel,
  footer,
  emptyState,
  resetKey,
  className,
  listClassName = "flex flex-col divide-y divide-border",
}: ProgressiveRevealProps<T>) {
  const [phase, setPhase] = useState<RevealPhase>("idle");
  const [revealedCount, setRevealedCount] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const timersRef = useRef<number[]>([]);

  const configRef = useRef({
    count: items.length,
    analyzingSteps,
    analyzeMs,
    stepMs,
  });
  configRef.current = {
    count: items.length,
    analyzingSteps,
    analyzeMs,
    stepMs,
  };

  const clearTimers = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  const start = useCallback(() => {
    clearTimers();
    const {
      count,
      analyzingSteps: stepsList,
      analyzeMs: analyzeDuration,
      stepMs: itemInterval,
    } = configRef.current;

    if (count === 0) {
      setRevealedCount(0);
      setStepIndex(0);
      setPhase("done");
      return;
    }

    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      setRevealedCount(count);
      setStepIndex(0);
      setPhase("done");
      return;
    }

    const steps = stepsList.length > 0 ? stepsList : DEFAULT_STEPS;
    setPhase("analyzing");
    setRevealedCount(0);
    setStepIndex(0);

    if (steps.length > 1) {
      const interval = Math.max(120, Math.floor(analyzeDuration / steps.length));
      for (let i = 1; i < steps.length; i++) {
        const t = window.setTimeout(() => setStepIndex(i), i * interval);
        timersRef.current.push(t);
      }
    }

    const startRevealTimer = window.setTimeout(() => {
      setPhase(count === 1 ? "done" : "revealing");
      setRevealedCount(1);

      for (let i = 2; i <= count; i++) {
        const itemTimer = window.setTimeout(() => {
          setRevealedCount(i);
          if (i === count) setPhase("done");
        }, (i - 1) * itemInterval);
        timersRef.current.push(itemTimer);
      }
    }, analyzeDuration);

    timersRef.current.push(startRevealTimer);
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    clearTimers();
    if (autoStart) {
      const kickoff = window.setTimeout(start, 0);
      timersRef.current.push(kickoff);
      return clearTimers;
    }
    setPhase("idle");
    setRevealedCount(0);
    setStepIndex(0);
    return undefined;
  }, [autoStart, resetKey, start, clearTimers]);

  const visibleItems = items.slice(0, revealedCount);
  const activeStep =
    analyzingSteps[Math.min(stepIndex, Math.max(0, analyzingSteps.length - 1))] ??
    DEFAULT_STEPS[0];
  const hasTitleBlock = title != null || subtitle != null;
  const hasRightBadge =
    phase === "revealing" || (phase === "done" && items.length > 0);

  return (
    <section
      className={cx(
        "flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5",
        className,
      )}
    >
      {(hasTitleBlock || hasRightBadge) && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          {hasTitleBlock ? (
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className={cx(
                  "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink",
                  phase === "analyzing" && "animate-pulse",
                )}
              >
                <Icon name={icon} size={17} />
              </span>
              <div className="min-w-0 space-y-0.5">
                {title != null ? (
                  <h2 className="m-0 text-[0.9375rem] font-semibold leading-snug tracking-tight text-ink">
                    {title}
                  </h2>
                ) : null}
                {subtitle != null ? (
                  <div className="text-xs leading-relaxed text-muted">{subtitle}</div>
                ) : null}
              </div>
            </div>
          ) : null}

          {phase === "revealing" && (
            <span
              className={cx(
                "inline-flex shrink-0 items-center rounded-full bg-accent-soft px-2.5 py-0.5 font-numeric text-xs font-medium tabular-nums text-accent-ink",
                !hasTitleBlock && "ml-auto",
              )}
            >
              {progressLabel(revealedCount, items.length)}
            </span>
          )}

          {phase === "done" && items.length > 0 && (
            <div
              className={cx(
                "flex shrink-0 items-center gap-2",
                !hasTitleBlock && "ml-auto",
              )}
            >
              <span className="text-xs font-medium text-muted">
                {doneMeta(items.length)}
              </span>
              {replayLabel ? (
                <Button variant="quiet" size="sm" onClick={start}>
                  {replayLabel}
                </Button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {phase === "idle" && !autoStart && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm" icon={icon} onClick={start}>
            {triggerLabel}
          </Button>
          {triggerHint != null ? (
            <span className="text-xs text-muted">{triggerHint}</span>
          ) : null}
        </div>
      )}

      {phase === "analyzing" && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-3 rounded-xl border border-border bg-surface-2/60 px-4 py-3.5 text-sm text-ink-2"
        >
          <span className="chat-dots text-accent-ink" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>{activeStep}</span>
        </div>
      )}

      {(phase === "revealing" || phase === "done") && (
        <>
          {items.length === 0 ? (
            emptyState ?? (
              <p className="m-0 text-sm text-muted">
                Nenhum destaque para mostrar no momento.
              </p>
            )
          ) : (
            <div className={listClassName} aria-live="polite">
              {visibleItems.map((item, index) => (
                <div key={getKey(item, index)} className="ds-reveal-item">
                  {renderItem(item, index)}
                </div>
              ))}
            </div>
          )}

          {phase === "done" && footer != null ? (
            <div className="ds-reveal-item flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              {footer}
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
