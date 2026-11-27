"use client";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type TransitionEvent,
} from "react";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type Height = number | "none";

/**
 * Altura animada de um bloco que abre e fecha (a mesma do StatBanner).
 * max-height em PX medido no scrollHeight: abrir é 0 -> altura, fechar é
 * altura -> 0. Depois de aberto vira "none", para o conteúdo poder crescer
 * (um expand aninhado lá dentro) sem ser cortado. "none" nunca é ponto de
 * partida de transição: antes de fechar, volta para a altura em px.
 * `replay` muda a cada abertura real, para remedir quando o conteúdo remonta.
 */
export function useExpandHeight(open: boolean, replay: unknown = null) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [maxH, setMaxH] = useState<Height>(open ? "none" : 0);
  // Último estado efetivamente aplicado: na montagem inicial nada mudou.
  const committed = useRef({ open, replay });

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (committed.current.open === open && committed.current.replay === replay) return;
    if (!el) return;
    if (prefersReducedMotion()) {
      committed.current = { open, replay };
      setMaxH(open ? "none" : 0);
      return;
    }
    // Primeiro o valor de partida, o alvo só no próximo quadro: o navegador
    // precisa ver os dois em commits separados para interpolar.
    setMaxH(open ? 0 : el.scrollHeight);
    let doneTimer: number | null = null;
    const raf = requestAnimationFrame(() => {
      committed.current = { open, replay };
      const target: Height = open
        ? el.scrollHeight > 0
          ? el.scrollHeight
          : "none"
        : 0;
      setMaxH(target);
      if (open && target !== "none") {
        doneTimer = window.setTimeout(() => setMaxH("none"), 450);
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      if (doneTimer !== null) window.clearTimeout(doneTimer);
    };
  }, [open, replay]);

  const style: CSSProperties = { maxHeight: maxH };
  const onTransitionEnd = (e: TransitionEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && e.propertyName === "max-height" && open)
      setMaxH("none");
  };
  return { bodyRef, style, onTransitionEnd };
}
