"use client";
import { useEffect, useId, useState } from "react";
import type { ReactNode } from "react";
import { formatReais } from "../lib/cents.ts";
import { Icon } from "./icon.tsx";
import { cx } from "./shared";

/** 15518 → "15.518": o campo mostra o milhar como o resto do app. */
const group = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

/**
 * Campo de valor em reais inteiros com botões − e +. Aceita só dígitos, limita
 * a [min, max] e usa ↑/↓ para somar o passo. Não grava nada: devolve o valor
 * por `onChange`. Com `hidden`, o número não aparece no campo.
 */
export function AmountStepper({
  label,
  value,
  onChange,
  step = 50,
  min = 0,
  max = 999_999,
  hint,
  compact,
  disabled,
  hidden,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  hint?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
  /** "Ocultar valores": o campo mostra •••• e não aceita digitação; − e + continuam. */
  hidden?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState(group(value));
  useEffect(() => setText(group(value)), [value]);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const stepText = formatReais(step);
  return (
    <div className={cx("ds-reset", "ds-amount", compact && "is-compact")}>
      <label htmlFor={id}>{label}</label>
      <div className="ds-amount-row">
        <button
          type="button"
          aria-label={`Diminuir ${label} em ${stepText}`}
          onClick={() => onChange(clamp(value - step))}
          disabled={disabled || value <= min}
        >
          <Icon name="minus" />
        </button>
        <span className="ds-amount-field">
          <span aria-hidden>R$</span>
          <input
            id={id}
            inputMode="numeric"
            autoComplete="off"
            value={hidden ? "••••" : text}
            readOnly={hidden}
            disabled={disabled}
            onChange={(e) => {
              if (hidden) return;
              const raw = e.target.value.replace(/\D/g, "").slice(0, 9);
              if (raw === "") return setText("");
              const next = clamp(Number(raw));
              setText(group(next));
              onChange(next);
            }}
            onBlur={() => setText(group(clamp(value)))}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                onChange(clamp(value + step));
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                onChange(clamp(value - step));
              }
            }}
          />
        </span>
        <button
          type="button"
          aria-label={`Aumentar ${label} em ${stepText}`}
          onClick={() => onChange(clamp(value + step))}
          disabled={disabled || value >= max}
        >
          <Icon name="plus" />
        </button>
      </div>
      {hint ? <p className="ds-amount-hint">{hint}</p> : null}
    </div>
  );
}
