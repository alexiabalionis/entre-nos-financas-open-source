"use client";
import { createContext, useContext } from "react";
import type { ReactNode } from "./shared";

type PanelProps = {
  /** Título do cabeçalho. Sem title e sem meta, o cabeçalho é omitido. */
  title?: string;
  /** Texto auxiliar à direita do título. */
  meta?: string;
  /** Cor do dot ao lado do meta. É DADO (cor dinâmica), não tom semântico,
   *  então vai inline via style — único hex permitido aqui. */
  metaDot?: string;
  /** Remove fundo/padding (vira só um agrupador de seção). */
  flush?: boolean;
  children?: ReactNode;
};

/**
 * Dentro de um contêiner que já é cartão (ex. ProfileCard), o Panel vira
 * seção plana: título e conteúdo, separados das vizinhas por uma linha.
 * Cartão dentro de cartão some sem cada tela precisar passar `flush`.
 */
const FlatPanels = createContext(false);

export function FlatPanelsProvider({ children }: { children: ReactNode }) {
  return <FlatPanels.Provider value>{children}</FlatPanels.Provider>;
}

/**
 * Cartão de seção com cabeçalho opcional. Porta do Panel do ds-kit: só compõe
 * as classes já existentes em family.css, sem inventar estilo.
 */
export function Panel({ title, meta, metaDot, flush, children }: PanelProps) {
  const flat = useContext(FlatPanels);
  const head =
    title || meta ? (
      <div className="ds-panel-h flex items-center justify-between gap-2">
        <h2 className="card-title m-0 text-base leading-snug">{title ?? ""}</h2>
        {meta ? (
          <span className="ds-panel-meta inline-flex items-center gap-1.5 text-xs text-base-content/60">
            {metaDot ? (
              // metaDot é cor de DADO -> só a cor do dot vai inline.
              <span className="ds-dot status status-xs" style={{ background: metaDot }} />
            ) : null}
            {meta}
          </span>
        ) : null}
      </div>
    ) : null;
  if (flat && !flush)
    return (
      <section className="ds-panel-flat flex min-w-0 flex-col gap-3 border-t border-base-300 pt-4 first:border-t-0 first:pt-0 [&>p]:m-0">
        {head}
        {children}
      </section>
    );
  return (
    <section className={flush ? "ds-panel flush" : "ds-panel card card-border bg-base-100 shadow-sm"}>
      {flush ? (
        <>
          {head}
          {children}
        </>
      ) : (
        <div className="card-body">
          {head}
          {children}
        </div>
      )}
    </section>
  );
}
