import { useEffect, useState } from "react";
import { Button } from "../ds/button.tsx";
import { Icon } from "../ds/icon.tsx";
import { cx } from "../ds/shared.ts";

/** Avatar da Judite: a mesma estrela da navegação. `working` acende o anel. */
export function JuditeAvatar({
  size = "md",
  working = false,
  className,
}: {
  size?: "sm" | "md";
  working?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "judite-avatar grid shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink",
        size === "sm" ? "size-7" : "size-8",
        working && "is-working",
        className,
      )}
      aria-hidden="true"
    >
      <Icon name="sparkle" size={size === "sm" ? 14 : 16} />
    </span>
  );
}

// A resposta não chega em partes: o servidor devolve tudo no fim. Então as
// etapas são pelo tempo de espera, ditas sem prometer o que está acontecendo
// por dentro — o objetivo é a pessoa saber que não travou e quando vale parar.
const STAGES: [number, string][] = [
  [0, "Pensando no seu pedido…"],
  [4, "Consultando o histórico da família…"],
  [
    15,
    "Ainda trabalhando. Perguntas que cruzam vários meses levam mais tempo.",
  ],
  [40, "Está demorando mais que o normal."],
];
const LONG_WAIT = 40;

function clock(seconds: number) {
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

/**
 * Linha de espera no lugar da próxima resposta. Mesmo formato de uma mensagem
 * da Judite (avatar + balão), para a resposta chegar onde a espera estava.
 */
export function JuditeWaiting({ onStop }: { onStop?: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - start) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, []);
  const stage = STAGES.reduce(
    (current, [at, text]) => (elapsed >= at ? text : current),
    STAGES[0][1],
  );
  const long = elapsed >= LONG_WAIT;
  return (
    <div className="chat-waiting flex items-start gap-2.5">
      <JuditeAvatar size="sm" working className="mt-0.5" />
      <div className="max-w-[88%] rounded-2xl rounded-tl-md border border-border bg-accent-soft/60 px-4 py-3 text-[0.9375rem] text-ink shadow-xs sm:max-w-[80%]">
        <div className="flex items-center gap-2.5">
          <span className="chat-dots text-accent-ink" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          {/* Só a etapa é anunciada; o relógio fica fora do leitor de tela. */}
          <span role="status" className="min-w-0 leading-snug">
            {stage}
          </span>
          {elapsed >= 3 && (
            <span
              className="ml-auto shrink-0 pl-1 text-[0.75rem] text-ink-2 tabular-nums"
              aria-hidden="true"
            >
              {clock(elapsed)}
            </span>
          )}
        </div>
        {long && onStop && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-2">
            <p className="m-0 text-[0.8125rem] leading-snug text-ink-2">
              Você pode continuar esperando ou parar. A mensagem enviada fica
              salva.
            </p>
            <Button size="sm" variant="quiet" onClick={onStop}>
              Parar a espera
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Resposta que segue em andamento no servidor (ex.: depois de recarregar). */
export function JuditeInProgress() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="chat-dots text-accent-ink" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span>Resposta em andamento. A conversa atualiza sozinha.</span>
    </div>
  );
}
