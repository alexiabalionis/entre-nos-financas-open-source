"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { cx } from "./shared";

type Pill = { left: number; top: number; width: number; height: number };

/**
 * Seletor segmentado (radiogroup): uma opção marcada por vez, setas, Home e End
 * navegam. A pílula desliza até a opção. Não guarda estado: o valor vem de fora.
 */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  size = "md",
  fill = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
  /** Ocupa a largura toda, abas divididas por igual (quando tem linha própria). */
  fill?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = options.findIndex((o) => o.value === value);
  const count = options.length;

  // Posição da aba ativa dentro do grupo. Remede quando a opção muda e quando
  // o grupo muda de tamanho (fonte carregando, rótulos trocando, rotação).
  const [pill, setPill] = useState<Pill | null>(null);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const measure = () => {
      const tab = root.querySelectorAll<HTMLButtonElement>("button")[idx];
      setPill((prev) => {
        if (!tab) return null;
        const next = {
          left: tab.offsetLeft,
          top: tab.offsetTop,
          width: tab.offsetWidth,
          height: tab.offsetHeight,
        };
        return prev &&
          prev.left === next.left &&
          prev.top === next.top &&
          prev.width === next.width &&
          prev.height === next.height
          ? prev
          : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [idx, count]);

  const go = (n: number) => {
    onChange(options[n].value);
    ref.current?.querySelectorAll<HTMLButtonElement>("button")[n]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const from = idx < 0 ? 0 : idx;
    let n: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (from + 1) % count;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (from - 1 + count) % count;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = count - 1;
    if (n === null) return;
    e.preventDefault();
    go(n);
  };

  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      data-pill={pill ? "" : undefined}
      // sm = degrau de filtro: 32px no total (aba 28px + 2px de borda interna)
      // e 13px, um nível abaixo dos campos (40px). md fica no padrão do tema.
      className={cx(
        "ds-seg tabs tabs-box relative isolate flex-nowrap",
        fill ? "w-full min-w-max [&>.tab]:flex-1" : "w-fit",
        size === "sm" &&
          "tabs-sm p-0.5 [--tab-height:calc(var(--size-field)*7)] [&>.tab]:px-3 [&>.tab]:text-[0.8125rem] [&>.tab]:whitespace-nowrap",
      )}
      onKeyDown={onKeyDown}
    >
      {/* A pílula branca da opção marcada: medida da aba ativa e movida por
          transform (sem relayout). Até a 1ª medição, a própria aba ativa pinta
          o fundo (sem data-pill), então nunca há quadro sem destaque. */}
      {pill && (
        <span
          aria-hidden="true"
          className="ds-seg-pill"
          style={{
            width: pill.width,
            height: pill.height,
            transform: `translate(${pill.left}px, ${pill.top}px)`,
          }}
        />
      )}
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          type="button"
          className={cx("tab", i === idx && "tab-active")}
          role="radio"
          aria-checked={i === idx}
          tabIndex={i === idx || (idx < 0 && i === 0) ? 0 : -1}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
