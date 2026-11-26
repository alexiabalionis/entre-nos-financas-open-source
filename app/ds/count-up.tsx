"use client";
import { useEffect, useState, type ReactNode } from "react";

type CountUpProps = {
  /** Valor final, na escala que o chamador formata (ex.: reais, não centavos). */
  value: number;
  /** Formata o valor interpolado a cada quadro — mesma função do valor final.
   *  O primitivo não sabe o que é moeda (sem domínio aqui, como o resto do ds/). */
  format: (value: number) => ReactNode;
  /** Duração da subida em ms (default 650 — entrada autoral do número em destaque). */
  durationMs?: number;
};

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Anima um número subindo de 0 até `value` (ease-out), formatado a cada
 * quadro pelo `format` do chamador. Reinicia a subida sempre que `value`
 * muda (nova leitura = novo número subindo). Pula direto pro valor final em
 * prefers-reduced-motion.
 */
export function CountUp({ value, format, durationMs = 650 }: CountUpProps) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));

  // Sem ref de "valor anterior": o próprio array de deps do effect já só
  // reexecuta quando `value` muda de verdade. Uma ref guardião aqui soma com
  // o duplo mount do Strict Mode (mount -> cleanup cancela o raf -> remount
  // já vê a ref setada e sai antes de agendar o raf de novo) e trava em 0.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      setShown(value * easeOutCubic(t));
      if (t < 1) raf = requestAnimationFrame(tick);
      else setShown(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <>{format(shown)}</>;
}
