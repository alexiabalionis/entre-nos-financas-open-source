"use client";
import type { CSSProperties } from "react";

type Segment = {
  /** Peso relativo do segmento (vira flex). */
  value: number;
  /** Cor do segmento (dado dinâmico, não token). */
  color: string;
};

type SegmentedBarProps = {
  segments: Segment[];
  /** Descrição acessível do que a barra representa. */
  aria?: string;
};

/**
 * Barra composta por segmentos proporcionais. A cor de cada segmento é DADO
 * dinâmico (vem do chamador), então vai inline — exceção justificada à regra
 * de tom-via-token. O trilho e o gap são do family.css.
 */
export function SegmentedBar({ segments, aria = "composição" }: SegmentedBarProps) {
  return (
    <div className="ds-segbar" role="img" aria-label={aria}>
      {segments.map((s, i) => {
        // flex pela magnitude (mínimo 1 pra o segmento nunca sumir) + cor-dado inline.
        const style: CSSProperties = {
          flex: Math.max(s.value, 1),
          background: s.color,
        };
        return <span key={i} style={style} />;
      })}
    </div>
  );
}
