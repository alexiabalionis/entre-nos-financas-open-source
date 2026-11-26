"use client";
import type { Decision } from "../../src/domain/future-months.ts";
import { Button, Icon, type IconName } from "../ds/index.ts";
import { RowList } from "../ds/row-list.tsx";
import type { Tone } from "../ds/shared.ts";
import { maskMoney } from "../lib/cents.ts";
import { useFutureContext } from "./future-context.tsx";

const TONE: Record<Decision["tone"], { tone: Tone; icon: IconName }> = {
  atencao: { tone: "warn", icon: "alert" },
  oportunidade: { tone: "ok", icon: "spark" },
  info: { tone: "neutral", icon: "info" },
};

/**
 * As próximas decisões que a projeção enxerga, cada uma com a conta e o
 * impacto. "Testar" aplica a sugestão ao rascunho; nunca grava. Não decide nada:
 * a lista vem pronta do motor.
 */
export function DecisionList() {
  const f = useFutureContext();
  const list = f.draft?.decisions ?? [];
  if (list.length === 0) return <p className="ds-caption">Nenhuma decisão pendente neste horizonte.</p>;
  return (
    <RowList
      rows={list.map((d) => ({
        icon: <Icon name={TONE[d.tone].icon} size={16} />,
        iconSize: "sm" as const,
        tone: TONE[d.tone].tone,
        title: maskMoney(d.title, f.hidden),
        sub: maskMoney(d.calc, f.hidden),
        children: <small className="block text-xs">{maskMoney(d.impact, f.hidden)}</small>,
        trail: d.action ? (
          <Button
            variant="text"
            aria-label={`Testar: ${maskMoney(d.action.label, f.hidden)}`}
            onClick={() => f.patch(d.action!.scenario)}
          >
            Testar
          </Button>
        ) : undefined,
      }))}
    />
  );
}
