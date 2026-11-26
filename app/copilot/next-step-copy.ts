// Texto do "próximo passo" para os casos sem ação de reserva (puro). Os casos
// de decidir e separar a reserva têm componentes próprios.
import type { CopilotWire } from "../../src/server/copilot.ts";
import type { Tone } from "../ds/shared.ts";
import { ddmm } from "../month/format.ts";
import type { Money } from "./money.ts";

export type StepCopy = {
  tone: Tone;
  icon: string;
  title: string;
  meta?: string;
  body: string;
};

const GAP_TEXT: [string, string][] = [
  ["saldo:", "Atualize o saldo das contas. Sem o saldo de hoje, a gente não consegue calcular o mês."],
  ["income:", "Cadastre quando o salário entra, para a gente saber até quando o dinheiro precisa durar."],
  ["everyday:sem-historico", "Ainda não há semanas suficientes de gastos para estimar o dia a dia."],
  ["bill:", "Confira a fatura do cartão: o valor dela ainda não está claro."],
];

export function stepCopy(c: CopilotWire, money: Money): StepCopy | null {
  const a = c.action;
  const until = ddmm(c.until);
  switch (a.kind) {
    case "need_data": {
      const key = a.gap?.key ?? "";
      const text = GAP_TEXT.find(([p]) => key.startsWith(p))?.[1];
      return {
        tone: "warn",
        icon: "?",
        title: "Precisa de você",
        body: text ?? (a.gap?.reason || "Falta uma informação para calcular o mês."),
      };
    }
    case "overdue": {
      const item = c.overdue.find((o) => o.id === a.item.id);
      return {
        tone: "warn",
        icon: "!",
        title: "Tem conta vencida em aberto",
        meta: item ? `${item.label} · venceu em ${ddmm(item.due)}` : undefined,
        body: `${money(BigInt(a.item.amount))} ainda não aparece como pago. Se já pagou, marque como pago.`,
      };
    }
    case "short":
      return {
        tone: "warn",
        icon: "!",
        title: "O mês está apertado",
        meta: a.overspent.length
          ? "Acima do normal: " +
            a.overspent.map((o) => `${o.category.toLowerCase()} +${money(BigInt(o.over))}`).join(", ")
          : undefined,
        body: a.missing
          ? `Faltam ${money(BigInt(a.missing))} para as contas e o dia a dia até ${until}.`
          : `O dinheiro está no limite até ${until}.`,
      };
    case "income_late":
      return {
        tone: "accent",
        icon: "↑",
        title: "O salário ainda não apareceu",
        meta: `Previsto para ${ddmm(a.receipt.expectedDate)}`,
        body: "Enquanto não aparecer no extrato, ele não conta como dinheiro na conta.",
      };
    case "ok":
      return {
        tone: "ok",
        icon: "✓",
        title: "Tudo certo por agora",
        body: a.livre
          ? `Você tem ${money(BigInt(a.livre))} livres até ${until}.`
          : "Nada para fazer agora.",
      };
    default:
      return null;
  }
}
