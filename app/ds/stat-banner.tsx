"use client";
import { useId, useState } from "react";
import type { ReactNode, Toned } from "./shared";
import { cx } from "./shared";
import { useExpandHeight } from "./use-expand-height.ts";

type ProgressRailProps = Toned & {
  /** Percentual 0..100. É DADO -> a largura vai inline via style (a cor vem do
   *  tom/token no CSS, nunca inline). */
  pct: number;
  inverted?: boolean;
};

const progressTone: Record<NonNullable<Toned["tone"]>, string> = {
  ok: "progress-success",
  warn: "progress-warning",
  danger: "progress-error",
  accent: "progress-accent",
  neutral: "",
};

/**
 * Trilha de progresso. Átomo LOCAL do StatBanner (único consumidor). A cor é
 * resolvida por data-tone no CSS; só a largura (dado) é inline.
 */
function ProgressRail({ pct, tone }: ProgressRailProps) {
  const width = Math.max(0, Math.min(100, pct));
  return (
    <progress
      className={cx("ds-rail progress mt-4 w-full", tone && progressTone[tone])}
      value={width}
      max={100}
      aria-valuenow={width}
      aria-valuemin={0}
      aria-valuemax={100}
    />
  );
}

type StatBannerProps = {
  /** Rótulo pequeno em caixa alta acima do valor. ReactNode para caber um
   *  IconBadge junto do texto (ex.: GoalCard). */
  eyebrow?: ReactNode;
  /** Valor em destaque. ReactNode porque o chamador pode já formatar (MoneyText). */
  value: ReactNode;
  /** Usa a variante "title" (valor menor, multilinha). */
  title?: boolean;
  /** Texto de apoio abaixo do valor. */
  caption?: ReactNode;
  /** Percentual da trilha (0..100). Se não for null/undefined, renderiza a ProgressRail. */
  rail?: number | null;
  /** Tom da trilha. */
  railTone?: Toned["tone"];
  /** Slot à direita do eyebrow (chip, botão, etc.). */
  trailing?: ReactNode;
  /** Variante escura (hero). */
  inverted?: boolean;
  /** Marca o valor como negativo (cor). */
  neg?: boolean;
  /** Slot livre no rodapé do banner — sempre visível (ex.: a ressalva do
   *  porquê). Não confundir com `expand`, que é o conteúdo recolhido. */
  children?: ReactNode;
  /** Quando presente, o cartão inteiro vira um disclosure: tocar em qualquer
   *  parte (inclui `children`) revela `content` — o "como chegamos nesse
   *  número". `label` é o texto do gatilho, com a setinha ↓/↑ do CSS. Gatilho
   *  é um <button> com aria-expanded/aria-controls, não <details> nativo —
   *  ver comentário no corpo da função sobre por que <details> não dá pra
   *  animar aqui. `content` fica sempre no DOM (precisa pra medir a altura
   *  real em px); só a CHAVE do nó muda a cada abertura real, remontando-o
   *  pra tocar de novo as animações de entrada dos gráficos/barras lá
   *  dentro — sem isso elas tocariam só uma vez. */
  expand?: { label: ReactNode; content: ReactNode };
  /** Tocar no valor revela `content` logo abaixo dele (ex.: saldo por conta).
   *  Com isto, o gatilho do `expand` fica só na linha do rótulo, para os dois
   *  botões não ficarem um dentro do outro. */
  valueDetail?: { label: string; content: ReactNode };
};

/**
 * Banner de métrica em destaque. Porta do StatBanner do ds-kit: compõe as
 * classes de family.css e delega a trilha à ProgressRail.
 */
export function StatBanner({
  eyebrow,
  value,
  title,
  caption,
  rail,
  railTone,
  trailing,
  inverted,
  neg,
  children,
  expand,
  valueDetail,
}: StatBannerProps) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const detailId = useId();
  // Sobe a cada abertura real (não a cada re-render) pra virar a key do
  // conteúdo revelado — remonta só ELE (não o wrap que anima a altura),
  // reiniciando as animações de entrada de dentro a cada vez que abre.
  const [openCount, setOpenCount] = useState(0);
  // Altura animada: ver use-expand-height.ts (o porquê de px medido em vez
  // de grid 0fr->1fr ou <details> nativo, que não animam o fechar aqui).
  const height = useExpandHeight(open, openCount);
  const contentId = useId();

  // "inverted" = herói da tela Mês. Era um bloco âmbar (bg-primary) que brigava
  // com chips, legendas e valores coloridos dentro dele; agora é o mesmo
  // cartão neutro dos outros, com o número maior dando o destaque.
  const shell = inverted
    ? "inverted card card-border bg-base-100 p-5 shadow-sm"
    : "stats w-full";
  const wrap = (node: ReactNode) => (inverted ? node : <div className="stat">{node}</div>);

  const top = (
    <>
      <div className="ds-stat-top flex items-center justify-between gap-2.5">
        <span className={cx("ds-eyebrow", inverted ? "text-sm opacity-60" : "stat-title whitespace-normal")}>
          {eyebrow ?? ""}
        </span>
        {trailing}
      </div>
      <div
        className={cx(
          // fonte numérica do app (Space Grotesk) nos valores
          "ds-value tabular-nums [font-family:var(--family-font-numeric)]",
          inverted ? "text-4xl font-semibold" : "stat-value",
          title && "title !text-2xl whitespace-normal",
          neg && "is-neg",
        )}
      >
        {valueDetail ? (
          <button
            type="button"
            className="ds-stat-value-btn inline-flex min-h-0 cursor-pointer items-baseline gap-2 rounded-none border-0 bg-transparent p-0 text-left [color:inherit] [font:inherit] hover:bg-transparent"
            aria-expanded={detailOpen}
            aria-controls={detailId}
            aria-label={valueDetail.label}
            onClick={() => setDetailOpen(!detailOpen)}
          >
            {value}
            <span className="ds-stat-expand-arrow text-base opacity-60" aria-hidden="true">
              ↓
            </span>
          </button>
        ) : (
          value
        )}
      </div>
      {valueDetail ? (
        <div id={detailId} hidden={!detailOpen} className="mt-2" data-stat-detail>
          {valueDetail.content}
        </div>
      ) : null}
      {caption != null ? (
        <p className={cx("ds-caption", inverted ? "text-sm opacity-60" : "stat-desc whitespace-normal")}>{caption}</p>
      ) : null}
      {rail != null ? <ProgressRail pct={rail} tone={railTone} inverted={inverted} /> : null}
      {children ? <div className="ds-stat-slot mt-4">{children}</div> : null}
    </>
  );

  if (!expand) {
    return <section className={cx("ds-stat", shell)}>{wrap(top)}</section>;
  }

  function handleToggleClick() {
    const nowOpen = !open;
    setOpen(nowOpen);
    if (nowOpen) setOpenCount((c) => c + 1);
  }

  return (
    <section className={cx("ds-stat", shell, open && "is-open")}>
      {wrap(
        <>
      {valueDetail ? (
        <>
          {/* Tocar em qualquer parte do card abre o detalhe, menos no botão do
              valor e na lista que ele abre; o teclado usa o botão do rótulo. */}
          <div
            className="cursor-pointer"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button, a, [data-stat-detail]")) return;
              handleToggleClick();
            }}
          >
            {top}
          </div>
          <button
            type="button"
            className="ds-stat-summary ds-stat-expand-hint mt-4 flex min-h-0 cursor-pointer items-center gap-1 rounded-none border-0 bg-transparent p-0 text-left text-xs font-medium opacity-70 [color:inherit] [font:inherit] hover:bg-transparent"
            aria-expanded={open}
            aria-controls={contentId}
            onClick={handleToggleClick}
          >
            {expand.label}
            <span className="ds-stat-expand-arrow" aria-hidden="true">
              ↓
            </span>
          </button>
        </>
      ) : (
      <button
        type="button"
        // utilitários zeram a base legada de <button> (fundo, borda, raio, padding, 46px)
        className="ds-stat-summary block min-h-0 w-full cursor-pointer rounded-none border-0 bg-transparent p-0 text-left [color:inherit] [font:inherit] hover:bg-transparent"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={handleToggleClick}
      >
        {top}
        <span className="ds-stat-expand-hint mt-4 flex items-center gap-1 text-xs font-medium opacity-70">
          {expand.label}
          <span className="ds-stat-expand-arrow" aria-hidden="true">
            ↓
          </span>
        </span>
      </button>
      )}
      <div
        id={contentId}
        className="ds-stat-expand-wrap"
        style={height.style}
        onTransitionEnd={height.onTransitionEnd}
      >
        <div className="ds-stat-expand-body mt-5 border-t border-base-300 pt-5" key={openCount} ref={height.bodyRef}>
          {expand.content}
        </div>
      </div>
        </>,
      )}
    </section>
  );
}
