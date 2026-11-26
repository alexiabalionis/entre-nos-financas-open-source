import { z } from "zod";
import type { Database } from "./db.ts";
import type { Identity } from "./auth.ts";
import { UserError } from "./imports.ts";
import { resolveRef } from "./chat-actions.ts";
import { readFuture } from "./future-plan.ts";
import { shiftMonth } from "../domain/card-cycle.ts";
import {
  applyScenario,
  compareFuture,
  describeScenario,
  projectFuture,
  type DiffItem,
  type FutureInput,
  type FutureResult,
  type Scenario,
} from "../domain/future-months.ts";

const cents = z
  .string()
  .regex(/^\d{1,15}$/)
  .refine((v) => BigInt(v) > 0n);
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const span = z.number().int().min(1).max(36);

// Simulação "e se": schema próprio, sem `type`, nunca vira chat_actions.
export const scenarioIntent = z
  .object({
    everyday_weekly_cents: cents.optional(),
    contributions: z
      .array(
        z
          .object({
            goal: z.string(),
            from_month: month,
            months: span,
            amount_cents: cents,
          })
          .strict(),
      )
      .optional(),
    pauses: z
      .array(
        z
          .object({ goal: z.string(), from_month: month, months: span })
          .strict(),
      )
      .optional(),
    shocks: z
      .array(
        z
          .object({
            kind: z.enum(["despesa", "receita"]),
            month,
            months: span,
            amount_cents: cents,
            label: z.string().trim().min(1).max(60),
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.everyday_weekly_cents !== undefined ||
      !!v.contributions ||
      !!v.pauses ||
      !!v.shocks,
  );
type ScenarioIntent = z.infer<typeof scenarioIntent>;

export function toScenario(
  raw: ScenarioIntent,
  goals: { id: string }[],
  input: FutureInput,
): Scenario {
  const last = shiftMonth(input.startMonth, input.months - 1);
  const inside = (m: string) => {
    if (m < input.startMonth || m > last)
      throw new UserError(
        `Informe um mês dentro dos próximos ${input.months} meses.`,
      );
    return m;
  };
  const goalId = (ref: string) => {
    const id = resolveRef(ref, "g", goals).id;
    if (!input.goals.some((g) => g.id === id))
      throw new UserError(
        "Não identifiquei esse objetivo com segurança. Informe o nome completo.",
      );
    return id;
  };
  const s: Scenario = {};
  // Aqui o valor é centavos inteiros (string), diferente do goal_contribute,
  // que passa por plainMoney. Não "corrigir": a convenção é deliberada.
  if (raw.contributions)
    s.contributions = raw.contributions.map((c) => ({
      goalId: goalId(c.goal),
      fromMonth: inside(c.from_month),
      months: c.months,
      cents: BigInt(c.amount_cents),
    }));
  if (raw.pauses)
    s.pauses = raw.pauses.map((p) => ({
      goalId: goalId(p.goal),
      fromMonth: inside(p.from_month),
      months: p.months,
    }));
  if (raw.shocks)
    s.shocks = raw.shocks.map((k) => ({
      kind: k.kind,
      month: inside(k.month),
      months: k.months,
      cents: BigInt(k.amount_cents),
      label: k.label,
    }));
  if (raw.everyday_weekly_cents !== undefined)
    s.everydayWeekly = BigInt(raw.everyday_weekly_cents);
  return s;
}

export function narrateScenario(describe: string[], diff: DiffItem[]): string {
  const lines = ["Simulação, nada foi salvo.", ...describe];
  if (diff.length === 0)
    lines.push("Esse cenário não muda o resultado dentro do horizonte.");
  else
    for (const d of diff)
      lines.push(
        `${d.label}: ${d.before} → ${d.after}${d.delta ? ` (${d.delta})` : ""}`,
      );
  return lines.join("\n");
}

export async function simulateScenario(
  db: Database,
  user: Identity,
  catalogGoals: { id: string }[],
  raw: ScenarioIntent,
  cached?: { input: FutureInput; result: FutureResult },
): Promise<string> {
  const { input, result } = cached ?? (await readFuture(db, user, {}));
  const s = toScenario(raw, catalogGoals, input);
  const result2 = projectFuture(applyScenario(input, s));
  const names = Object.fromEntries(input.goals.map((g) => [g.id, g.name]));
  const diff = compareFuture(
    result,
    result2,
    Math.min(input.months, 12),
    names,
  );
  return narrateScenario(describeScenario(input, s), diff);
}
