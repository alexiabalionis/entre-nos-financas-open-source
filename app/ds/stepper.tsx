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
  /** aria-label dos botões (acessibilidade). */
  prevLabel?: string;
  nextLabel?: string;
  onPrev?: () => void;
  onNext?: () => void;
  /** Presente: o label vira um botão focável (mesmas classes de texto) que
   *  dispara isto ao ser clicado — ex.: abrir o seletor de período. Ausente:
   *  nada muda, o label continua um texto simples. */
  onLabelClick?: () => void;
  /** aria-label do botão do label, quando onLabelClick está presente. */
  labelAriaLabel?: string;
};

/**
 * Navegador ‹ label › genérico (sem domínio). Os botões desabilitam via
 * canPrev/canNext e disparam onPrev/onNext. Setas e label clicável são
 * `btn btn-ghost` do daisyUI; o layout continua em family.css.
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
      <b className="text-sm">{label}</b>
      {caption != null ? <small className="block text-xs font-normal opacity-60">{caption}</small> : null}
    </>
  );
  return (
    <div className="ds-stepper flex items-center justify-between gap-1">
      <button
        type="button"
        className="btn btn-ghost btn-square"
        disabled={!canPrev}
        aria-label={prevLabel}
        onClick={onPrev}
      >
        <Icon name="left" size={18} />
      </button>
      {onLabelClick ? (
        <button
          type="button"
          className="ds-stepper-label ds-stepper-label-button btn btn-ghost h-auto flex-1 flex-col gap-0 py-1"
          aria-label={labelAriaLabel}
          onClick={onLabelClick}
        >
          {labelContent}
        </button>
      ) : (
        <span className="ds-stepper-label flex-1 text-center">{labelContent}</span>
      )}
      <button
        type="button"
        className="btn btn-ghost btn-square"
        disabled={!canNext}
        aria-label={nextLabel}
        onClick={onNext}
      >
        <Icon name="right" size={18} />
      </button>
    </div>
  );
}
