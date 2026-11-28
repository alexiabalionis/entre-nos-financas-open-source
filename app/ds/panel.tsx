"use client";
import { createContext, useContext } from "react";
import { cx, type ReactNode } from "./shared";

type PanelProps = {
  /** Título do cabeçalho. Sem title e sem meta, o cabeçalho é omitido. */
  title?: string;
  /** Texto auxiliar à direita do título. */
  meta?: string;
  /** Cor do dot ao lado do meta. É DADO (cor dinâmica), não tom semântico. */
  metaDot?: string;
  /** Remove fundo/padding (vira só um agrupador de seção). */
  flush?: boolean;
  /** Variante visual explícita ("card" com borda hairline ou "flat" apenas separador). */
  variant?: "card" | "flat";
  className?: string;
  children?: ReactNode;
};

/**
 * Dentro de um contêiner que já é cartão (ex. ProfileCard), o Panel vira
 * seção plana: título e conteúdo, separados das vizinhas por uma linha.
 */
const FlatPanels = createContext(false);

export function FlatPanelsProvider({ children }: { children: ReactNode }) {
  return <FlatPanels.Provider value>{children}</FlatPanels.Provider>;
}

/**
 * Cartão de seção com cabeçalho opcional. Superfície limpa com borda hairline
 * ou seção plana dentro de agrupadores.
 */
export function Panel({
  title,
  meta,
  metaDot,
  flush,
  variant,
  className,
  children,
}: PanelProps) {
  const flatCtx = useContext(FlatPanels);
  const isFlat = variant === "flat" || (flatCtx && !flush && variant !== "card");

  const head =
    title || meta ? (
      <div className="ds-panel-h flex items-center justify-between gap-3">
        <h2 className="m-0 text-[0.9375rem] font-semibold tracking-tight text-ink leading-snug">
          {title ?? ""}
        </h2>
        {meta ? (
          <span className="ds-panel-meta inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted">
            {metaDot ? (
              <span
                className="ds-dot inline-block size-2 rounded-full"
                style={{ background: metaDot }}
              />
            ) : null}
            {meta}
          </span>
        ) : null}
      </div>
    ) : null;

  if (isFlat) {
    return (
      <section
        className={cx(
          "ds-panel-flat flex min-w-0 flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0 [&>p]:m-0",
          className,
        )}
      >
        {head}
        {children}
      </section>
    );
  }

  if (flush) {
    return (
      <section className={cx("ds-panel flush flex min-w-0 flex-col gap-3", className)}>
        {head}
        {children}
      </section>
    );
  }

  return (
    <section
      className={cx(
        "ds-panel flex min-w-0 flex-col gap-4 rounded-2xl border border-border bg-surface p-5",
        className,
      )}
    >
      {head}
      {children}
    </section>
  );
}
