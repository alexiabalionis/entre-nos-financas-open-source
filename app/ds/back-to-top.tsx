"use client";
import { useEffect, useState } from "react";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

/**
 * Botão flutuante "voltar ao topo", acima da barra de navegação. Aparece
 * depois de rolar mais de uma tela. Ao voltar, o foco vai para o começo do
 * conteúdo (`focusId`), para teclado e leitor de tela não ficarem no fim da
 * página. Escondido, sai do foco e do leitor de tela.
 */
export function BackToTop({ focusId = "family-content" }: { focusId?: string }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setVisible(window.scrollY > window.innerHeight);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const goTop = () => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    const target = document.getElementById(focusId);
    if (target) {
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    }
  };

  return (
    <button
      type="button"
      onClick={goTop}
      aria-label="Voltar ao topo"
      title="Voltar ao topo"
      inert={!visible}
      className={cx(
        "ds-back-to-top btn btn-circle btn-primary fixed z-20 shadow-lg transition-[opacity,translate] duration-200 ease-out motion-reduce:transition-none",
        "right-[max(16px,env(safe-area-inset-right))] bottom-[calc(88px+env(safe-area-inset-bottom))]",
        visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
      )}
    >
      <Icon name="up" size={22} />
    </button>
  );
}
