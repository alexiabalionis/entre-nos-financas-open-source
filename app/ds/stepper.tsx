"use client";
import type { ReactNode } from "react";
import { Icon } from "./icon";

type StepperProps = {
  /** Texto central em destaque (ex: mês). */
  label: ReactNode;
  /** Legenda secundária abaixo do label. */
  caption?: ReactNode;
  canPrev?: boolean;
  canNext?: boolean;
  prevLabel?: string;
  nextLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  onLabelClick?: () => void;
  labelAriaLabel?: string;
};

/**
 * Navegador ‹ label › em formato pílula compacta.
 */
export function Stepper({
  label,
  caption,
  canPrev = true,
  canNext = true,
  prevLabel = "Anterior",
  nextLabel = "Próximo",
  onPrev,
  onNext,
  onLabelClick,
  labelAriaLabel,
}: StepperProps) {
  const labelContent = (
    <>
      <b className="block text-sm font-semibold text-ink leading-tight">{label}</b>
      {caption != null ? (
        <small className="block text-[0.75rem] font-normal text-muted leading-tight">
          {caption}
        </small>
      ) : null}
    </>
  );
  const arrowBtn =
    "ui-stepper-btn inline-flex size-9 [@media(pointer:coarse)]:size-10 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-ink cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <div className="ds-stepper inline-flex w-full sm:w-auto items-center justify-between gap-1 rounded-full border border-border bg-surface p-1">
      <button
        type="button"
        className={arrowBtn}
        disabled={!canPrev}
        aria-label={prevLabel}
        onClick={onPrev}
      >
        <Icon name="left" size={16} />
      </button>
      {onLabelClick ? (
        <button
          type="button"
          className="ds-stepper-label ds-stepper-label-button ui-stepper-btn flex min-w-0 flex-1 flex-col items-center justify-center rounded-full px-3.5 py-1 text-center transition-colors hover:bg-surface-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={labelAriaLabel}
          onClick={onLabelClick}
        >
          {labelContent}
        </button>
      ) : (
        <span className="ds-stepper-label flex min-w-0 flex-1 flex-col items-center px-3.5 py-1 text-center">
          {labelContent}
        </span>
      )}
      <button
        type="button"
        className={arrowBtn}
        disabled={!canNext}
        aria-label={nextLabel}
        onClick={onNext}
      >
        <Icon name="right" size={16} />
      </button>
    </div>
  );
}
