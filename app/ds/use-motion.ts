"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** true quando a pessoa pediu menos movimento. No servidor, false. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);

function pad(xs: number[], n: number, mode: "last" | "zero"): number[] {
  if (xs.length >= n) return xs.slice(0, n);
  const fill = mode === "zero" ? 0 : (xs[xs.length - 1] ?? 0);
  return [...xs, ...Array<number>(n - xs.length).fill(fill)];
}

/**
 * Interpola cada posição do vetor até o novo alvo (easeOutQuart). Se o vetor
 * crescer, as posições novas partem do último valor (pad "last", padrão) ou de
 * zero (pad "zero"). Com movimento reduzido devolve o alvo direto.
 */
export function useTween(target: number[], ms = 420, padMode: "last" | "zero" = "last"): number[] {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const key = target.join(",");
  const targetRef = useRef(target);
  targetRef.current = target;
  useEffect(() => {
    const to = targetRef.current;
    const from = shownRef.current;
    if (reduced || from.length === 0) {
      shownRef.current = to;
      setShown(to);
      return;
    }
    const f = pad(from, to.length, padMode);
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = easeOutQuart(t);
      const v = to.map((x, i) => f[i] + (x - f[i]) * e);
      shownRef.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [key, reduced, ms, padMode]);
  return reduced ? target : shown;
}

/** Versão de um número só de `useTween`. */
export function useTweenNumber(value: number, ms = 320): number {
  return useTween([value], ms)[0];
}

/** true por 1100 ms depois que `value` muda (comparação por JSON.stringify). false no primeiro render. */
export function useChanged(value: unknown): boolean {
  const [on, setOn] = useState(false);
  const first = useRef(true);
  const key = JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
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

/**
 * Props de animação do recharts para um primitivo de gráfico. Desligado por
 * padrão (os gráficos do app são estáticos); com `animate`, as barras/linhas
 * crescem na entrada e vão do valor antigo ao novo quando os dados mudam.
 * Movimento reduzido: sempre desligado.
 */
export function useChartAnimation(animate = false) {
  const reduced = useReducedMotion();
  const on = animate && !reduced;
  return {
    isAnimationActive: on,
    animationDuration: 420,
    animationEasing: "ease-out" as const,
  };
}
