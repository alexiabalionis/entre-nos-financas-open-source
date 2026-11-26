// Fase 3 da SPEC-JUDITE-LACUNAS: sequencia (compra de A seguida de B) contra a taxa de base.
import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../src/domain/day.ts";
import { investigationContext, sequence } from "../src/domain/spend-investigate.ts";
import type { Purchase } from "../src/domain/spend-patterns-core.ts";
import { investigationTags } from "../src/server/judite-tools-investigate.ts";
import { toolCall } from "../src/server/judite-tools-schema.ts";

const months = ["2026-01", "2026-02", "2026-03"];
const buy = (date: string, category: string, cents = 10_000): Purchase => ({
  date,
  cents: BigInt(cents),
  label: `${category} ${date}`,
  category,
  tag: "",
  account: "Conta",
  payment: "pix",
  type: "avulso",
  essential: false,
});
const ctxOf = (purchases: Purchase[]) => investigationContext({ purchases, accountsTime: {}, salaryDates: [], months });
const run = (a: Purchase[], b: Purchase[], days = 4, minCents: number | null = null) => {
  const ctx = ctxOf(a);
  return sequence(ctx, ctx.items, ctxOf(b).items, { days, minCents, category: "Delivery" }, (i) => i.p.label);
};
const weekly = (n: number) => Array.from({ length: n }, (_, k) => addDays("2026-01-05", 7 * k));

test("sequencia: delivery 1-3 dias depois do mercado em 9 de 12, raro no resto: indice > 1,5", () => {
  const triggers = weekly(12);
  const a = triggers.map((d) => buy(d, "Mercado"));
  const b = triggers.slice(0, 9).map((d, k) => buy(addDays(d, 1 + (k % 3)), "Delivery"));
  const out = run(a, b);
  assert.equal(out.gatilho.compras, 12);
  assert.equal(out.seguidas, 9);
  assert.equal(out.parte, 0.75);
  assert.ok(out.indice !== null && out.indice > 1.5, `indice ${out.indice}`);
  assert.equal(out.exemplos.length, 5);
  assert.equal(out.gasto_b_total_cents, 9 * 10_000);
});

test("sequencia: delivery todo dia tem parte alta mas indice perto de 1", () => {
  const a = weekly(12).map((d) => buy(d, "Mercado"));
  const b = Array.from({ length: 90 }, (_, k) => buy(addDays("2026-01-01", k), "Delivery"));
  const out = run(a, b);
  assert.equal(out.parte, 1);
  assert.ok(out.indice !== null && Math.abs(out.indice - 1) < 0.05, `indice ${out.indice}`);
});

test("sequencia: valor minimo filtra gatilho, fixa e parcela nao contam, janela que nao cabe fica fora", () => {
  const a = [buy("2026-01-05", "Mercado", 5_000), buy("2026-01-12", "Mercado", 20_000), buy("2026-03-30", "Mercado", 20_000)];
  const b = [buy("2026-01-06", "Delivery"), { ...buy("2026-01-13", "Delivery"), type: "fixa" as const }];
  const out = run(a, b, 4, 10_000);
  assert.equal(out.gatilho.compras, 1);
  assert.equal(out.seguidas, 0);
  assert.equal(out.gatilho.valor_minimo_cents, 10_000);
});

test("schema: sequencia exige depois_categoria; os campos novos so valem com sequencia", () => {
  const parse = (args: Record<string, unknown>) => toolCall.parse({ tool: { name: "investigar_gastos", ...args } });
  assert.throws(() => parse({ operacoes: ["sequencia"] }));
  assert.throws(() => parse({ operacoes: ["serie_mensal"], dias: 4 }));
  assert.throws(() => parse({ operacoes: ["serie_mensal"], depois_categoria: "c1" }));
  assert.throws(() => parse({ operacoes: ["serie_mensal"], valor_minimo_cents: "100" }));
  assert.throws(() => parse({ operacoes: ["sequencia"], depois_categoria: "c1", dias: 8 }));
  assert.doesNotThrow(() => parse({ operacoes: ["sequencia"], depois_categoria: "c1", dias: 3, valor_minimo_cents: "10000" }));
});

test("sequencia: o resultado ganha a etiqueta sequencia (e portanto uma ref iN)", () => {
  assert.deepEqual(investigationTags({ sequencia: { seguidas: 1 } }), ["sequencia"]);
  assert.deepEqual(investigationTags({}), []);
});
