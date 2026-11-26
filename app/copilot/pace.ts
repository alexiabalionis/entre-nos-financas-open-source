// Quanto cabe no dia a dia até o salário (puro). O livre (base menos margem
// e reserva) é dividido igualmente pelos dias que faltam. É seguro: como a
// base já desconta todas as contas até o salário, gastar o mesmo toda semana
// nunca deixa o saldo abaixo da margem, nem na véspera de uma conta. O ritmo
// de sempre aparece ao lado, só como referência.
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { RowProps } from "../ds/row.tsx";
import { ddmm } from "../month/format.ts";
import type { Money } from "./money.ts";

const STEP = 1000n;
const floorStep = (v: bigint) => (v / STEP) * STEP;

// Livre por semana (arredondado para baixo em R$ 10); null sem número.
export function weeklyBudget(c: CopilotWire): bigint | null {
  if (c.state === "INDETERMINADO" || c.daysLeft < 1) return null;
  const livre = BigInt(c.livre);
  if (livre <= 0n) return 0n;
  return floorStep((livre * 7n) / BigInt(c.daysLeft));
}

export function paceText(c: CopilotWire, money: Money): string | null {
  const budget = weeklyBudget(c);
  if (budget === null) return null;
  const until = ddmm(c.until);
  const usual = c.usualWeekly === null ? "" : ` Vocês costumam gastar ${money(BigInt(c.usualWeekly))} por semana.`;
  if (budget === 0n) return `Até ${until} não sobra para o dia a dia sem usar a margem.`;
  if (c.daysLeft < 7)
    return `Até ${until}: cabem ${money(floorStep(BigInt(c.livre)))} no dia a dia.${usual}`;
  return `Até ${until}: ${money(budget)} por semana para o dia a dia.${usual}`;
}

function daysIn(from: string, to: string): bigint {
  const ms = Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z");
  return BigInt(Math.round(ms / 86_400_000) + 1);
}

// Uma linha por semana até o salário: dia a dia (proporcional aos dias da
// semana) + contas que vencem nela. A semana com conta pesa mais.
export function weekRows(c: CopilotWire, money: Money): RowProps[] {
  const budget = weeklyBudget(c);
  if (budget === null) return [];
  return c.weeks.map((w) => {
    const everyday = floorStep((budget * daysIn(w.from, w.to)) / 7n);
    const bills = BigInt(w.bills);
    return {
      title: `${ddmm(w.from)} a ${ddmm(w.to)}`,
      sub: bills > 0n
        ? `dia a dia ${money(everyday)} + contas ${money(bills)}`
        : `dia a dia ${money(everyday)}`,
      trail: money(everyday + bills),
    };
  });
}
