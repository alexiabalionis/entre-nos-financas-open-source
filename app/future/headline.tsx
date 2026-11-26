"use client";
import { ChangedText } from "../ds/index.ts";
import { cx } from "../ds/shared.ts";
import { useFutureContext } from "./future-context.tsx";
import { HorizonSwitch } from "./horizon-switch.tsx";
import { headline } from "./view-model.ts";

/**
 * Cabeçalho da tela: "O futuro de vocês", a frase de destaque do rascunho
 * (que marca quando muda) e o seletor de horizonte. Não calcula: a frase vem
 * de headline() no modelo. Não mostra valores com "ocultar valores" ligado.
 */
export function Headline() {
  const f = useFutureContext();
  const result = f.draft ?? f.base;
  const input = f.draftInput;
  const text =
    result && input
      ? headline(input, result, f.months, f.hidden)
      : { lead: f.status === "error" ? f.error : "Carregando o futuro…", detail: "" };
  return (
    <header className={cx("ds-reset", "fut-headline")}>
      <div className="fut-headline-text">
        <p className="fut-headline-eyebrow">O futuro de vocês</p>
        <h1 className="fut-headline-lead" aria-live="polite">
          <ChangedText value={text.lead} />
        </h1>
        {text.detail ? <p className="fut-headline-detail">{text.detail}</p> : null}
      </div>
      <div className="fut-headline-switch">
        <HorizonSwitch />
      </div>
    </header>
  );
}
