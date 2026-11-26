"use client";
// Os quatro números do topo: quanto entra, quanto sai, quanto sobra e o
// melhor mês (médias dos meses fechados).
import { Stat, Stats } from "../ds/stat.tsx";
import type { InsightsWire } from "../../src/server/insights.ts";
import { shortMonth } from "./model.ts";
import { LiveMoney, LivePercent } from "./live-money.tsx";
import { ChangedText } from "../ds/animated-money.tsx";

export function SummaryCards({
  data,
  hidden,
}: {
  data: InsightsWire;
  hidden: boolean;
}) {
  const s = data.summary;
  if (!s) return <p className="ds-caption">Ainda não há um mês fechado com lançamentos para comparar.</p>;
  return (
    <Stats label="Resumo dos meses fechados" grid4>
      <Stat icon="in" tone="ok" title="Entra por mês" value={<LiveMoney cents={BigInt(s.avgIn)} hidden={hidden} />} caption="Média dos meses fechados" />
      <Stat icon="out" tone="danger" title="Sai por mês" value={<LiveMoney cents={BigInt(s.avgOut)} hidden={hidden} />} caption="Contas, cartão e dia a dia" />
      <Stat
        title="Sobra por mês"
        value={hidden ? "••••" : s.keptPct === null ? "—" : <LivePercent value={s.keptPct} />}
        neg={BigInt(s.keptAvg) < 0n}
        caption={<><LiveMoney cents={BigInt(s.keptAvg)} hidden={hidden} /> em média</>}
      />
      <Stat
        title="Melhor mês"
        value={<ChangedText value={shortMonth(s.best.month)} />}
        caption={<><LiveMoney cents={BigInt(s.best.kept)} hidden={hidden} /> sobraram</>}
      />
    </Stats>
  );
}
