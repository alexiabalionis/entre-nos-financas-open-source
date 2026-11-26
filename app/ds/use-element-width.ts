"use client";
import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

/** Mede a largura de um elemento (ResizeObserver). `fallback` vale até a primeira medida. */
export function useElementWidth<T extends HTMLElement>(fallback = 900): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}
