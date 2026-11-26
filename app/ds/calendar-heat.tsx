"use client";
import type { CSSProperties } from "react";

type CalendarHeatProps = {
  /** Mês exibido, 'YYYY-MM'. */
  month: string;
  /** Um valor por dia do mês (índice 0 = dia 1). null = dia ainda por vir. */
  days: (number | null)[];
  /** Formata o valor do dia (título do quadrado). */
  fmt?: (value: number) => string;
  aria?: string;
};

const WEEK = ["D", "S", "T", "Q", "Q", "S", "S"];

/**
 * Calendário de intensidade: um quadrado por dia, mais forte quanto maior o
 * valor. A cor vem do accent do tema (CSS, .ds-heat); só a intensidade (dado)
 * vai inline como variável. Sem recharts: é uma grade, não um gráfico.
 */
export function CalendarHeat({ month, days, fmt, aria = "Calendário do mês" }: CalendarHeatProps) {
  const lead = new Date(`${month}-01T12:00:00Z`).getUTCDay();
  const max = Math.max(1, ...days.map((v) => v ?? 0));
  return (
    <div className="ds-heat" role="img" aria-label={aria}>
      {WEEK.map((d, i) => (
        <span className="h" key={"h" + i}>
          {d}
        </span>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <span key={"l" + i} />
      ))}
      {days.map((v, i) => {
        if (v === null)
          return (
            <span key={i} className="future">
              {i + 1}
            </span>
          );
        // Intensidade nunca negativa: dia líquido negativo fica no mínimo (o valor com sinal segue no title).
        const style = { "--ds-heat": `${Math.round(12 + (Math.max(0, v) / max) * 88)}%` } as CSSProperties;
        return (
          <span key={i} className="day" style={style} title={fmt ? `${i + 1}: ${fmt(v)}` : undefined}>
            {i + 1}
          </span>
        );
      })}
    </div>
  );
}
