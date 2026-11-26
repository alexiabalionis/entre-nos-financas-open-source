"use client";
import { AnimatedMoney } from "./animated-money.tsx";
import { formatReais } from "../lib/cents.ts";
import { cx } from "./shared";
import type { CalcLine } from "./types.ts";

export type { CalcLine } from "./types.ts";

/**
 * A conta linha a linha: rótulo, valor, separador e total. Linha com `op`
 * mostra o valor sem sinal (o operador já diz se soma ou subtrai); só o total
 * fica vermelho quando é negativo. Linhas marcadas como
 * estimativa ficam em itálico e dizem "estimado" ao leitor de tela. Não calcula
 * nada: os valores e o total chegam prontos. Linha `nested` detalha a de cima
 * (recuada, menor) e não entra na soma.
 */
export function CalcList({
  lines,
  total,
  hidden,
  compareTotal,
}: {
  lines: CalcLine[];
  total?: { label: string; value: number };
  hidden?: boolean;
  compareTotal?: number;
}) {
  const showBefore = total !== undefined && compareTotal !== undefined && Math.round(compareTotal) !== Math.round(total.value);
  return (
    <dl className="ds-reset ds-calc">
      {lines.map((l) => (
        <div
          key={l.key}
          className={cx("ds-calc-line", l.estimate && "is-estimate", l.highlight && "is-highlight", l.nested && "is-nested")}
        >
          <dt>
            {l.op ? (
              <span className="ds-calc-op" aria-hidden>
                {l.op}
              </span>
            ) : null}
            <span className="ds-calc-label">
              {l.label}
              {l.estimate ? <span className="sr-only"> (estimado)</span> : null}
              {l.note ? <small>{l.note}</small> : null}
            </span>
          </dt>
          <dd>
            {/* Com operador, o sinal já está no "−": o valor aparece sem sinal e sem vermelho. */}
            <AnimatedMoney value={l.op ? Math.abs(l.value) : l.value} hidden={hidden} />
          </dd>
        </div>
      ))}
      {total ? (
        <div className="ds-calc-line is-total">
          <dt>
            <span className="ds-calc-label">{total.label}</span>
          </dt>
          <dd>
            {showBefore ? (
              <s className="ds-calc-before">
                <span className="sr-only">antes: </span>
                {hidden ? "••••" : formatReais(compareTotal)}
              </s>
            ) : null}
            <AnimatedMoney value={total.value} hidden={hidden} />
          </dd>
        </div>
      ) : null}
    </dl>
  );
}
