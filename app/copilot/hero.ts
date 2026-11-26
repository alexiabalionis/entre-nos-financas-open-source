// Modelo puro do topo do Copiloto: o número "Livre até" e o "Como chegamos
// nesse valor". Sem React; recebe o fio de GET family/copilot. A base é a
// mesma da aba Mês (saldo menos contas previstas); o dia a dia não é
// descontado, só comparado com o ritmo de sempre.
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { RowProps } from "../ds/row.tsx";
import type { Tone } from "../ds/shared.ts";
import { ddmm } from "../month/format.ts";
import type { Money } from "./money.ts";
import { weeklyBudget } from "./pace.ts";

export type HeroView = {
  eyebrow: string;
  value: string;
  title: boolean;
  caption: string;
  chip: { tone: Tone; label: string };
  expandable: boolean;
};

export function heroView(c: CopilotWire, money: Money): HeroView {
  const until = ddmm(c.until);
  const base = { eyebrow: `Livre até ${until}`, title: false, expandable: true };
  if (c.state === "INDETERMINADO")
    return {
      eyebrow: "Seu mês até o salário",
      value: "Faltam dados",
      title: true,
      caption: "Ainda não dá para dizer quanto você pode gastar. Falta uma informação.",
      chip: { tone: "neutral", label: "Indeterminado" },
      expandable: false,
    };
  const margin = BigInt(c.margin);
  const s = c.status;
  if (s.kind === "free") {
    const budget = weeklyBudget(c);
    const usual = c.usualWeekly === null ? null : BigInt(c.usualWeekly);
    const tight = usual !== null && budget !== null && budget < usual;
    return {
      ...base,
      value: money(BigInt(s.livre)),
      caption: tight
        ? "Dá para chegar, mas gastando menos que o normal no dia a dia."
        : "Já descontando contas, margem e reserva.",
      chip: tight
        ? { tone: "warn", label: "Apertado" }
        : c.state === "CONFIRMADO"
          ? { tone: "ok", label: "Confiável" }
          : { tone: "accent", label: "Com ressalva" },
    };
  }
  if (s.kind === "zero")
    return {
      ...base,
      value: money(0n),
      caption: "As contas estão cobertas, mas não sobra nada para o dia a dia além da margem.",
      chip: { tone: "warn", label: "Sem folga" },
    };
  if (s.kind === "margin")
    return {
      ...base,
      value: money(0n),
      caption: `As contas estão cobertas, usando ${money(BigInt(s.used))} da margem de ${money(margin)}.`,
      chip: { tone: "warn", label: "Usando a margem" },
    };
  return {
    ...base,
    value: `Faltam ${money(BigInt(s.missing))}`,
    caption: `As contas até ${until} passam do saldo, mesmo usando a margem.`,
    chip: { tone: "danger", label: "Sem folga" },
  };
}

const minus = (money: Money, v: bigint) => "−" + money(v);

// Linhas do "Como chegamos nesse valor": saldo, contas, reserva, margem e o
// livre para o dia a dia. Só mostra parcela diferente de zero (a margem
// sempre, para a pessoa saber que existe); a soma sempre fecha com o livre.
export function breakdownRows(c: CopilotWire, money: Money): RowProps[] {
  const b = c.breakdown;
  const n = (v: string) => BigInt(v);
  const low = ddmm(b.lowDay);
  const rows: (RowProps | null)[] = [
    { sw: "var(--family-cat-4)", title: "Na conta hoje", trail: money(n(b.start)) },
    n(b.income)
      ? { sw: "var(--family-cat-2)", title: `Entradas até ${low}`, trail: "+" + money(n(b.income)) }
      : null,
    n(b.bills)
      ? { sw: "var(--family-cat-6)", title: `Contas até ${low}`, sub: "contas, faturas e recorrentes", trail: minus(money, n(b.bills)) }
      : null,
    n(b.reserve)
      ? { sw: "var(--family-accent)", title: "Reserva do mês", sub: "combinada, ainda vai sair da conta", trail: minus(money, n(b.reserve)) }
      : null,
    n(b.adjust)
      ? {
          sw: "var(--family-cat-none)",
          title: "Ajuste do saldo",
          sub: "gastos desde a última atualização do saldo",
          trail: n(b.adjust) < 0n ? minus(money, -n(b.adjust)) : "+" + money(n(b.adjust)),
        }
      : null,
    {
      sw: "var(--family-warn)",
      title: "Margem de segurança",
      sub: c.marginChosen ? "escolhida por você" : "padrão: meia semana do dia a dia",
      trail: minus(money, n(b.margin)),
    },
    n(b.reserveOnAccount)
      ? { sw: "var(--family-accent)", title: "Reserva guardada na conta", sub: "fica na conta, mas não é para gastar", trail: minus(money, n(b.reserveOnAccount)) }
      : null,
  ];
  const livre = n(b.livre);
  return [
    ...rows.filter((r): r is RowProps => r !== null).map((r) => ({ ...r, bordered: false })),
    {
      title: "Livre para o dia a dia",
      trail: livre < 0n ? minus(money, -livre) : money(livre),
      bordered: true,
    },
  ];
}
