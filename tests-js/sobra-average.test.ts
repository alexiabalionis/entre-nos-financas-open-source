// Sobra média: uma regra só (a do Panorama). Valores esperados calculados à
// mão, não pelas funções de produção.
import { test } from "node:test";
import assert from "node:assert/strict";
import { averageFlows, monthSummary } from "../src/domain/insights.ts";
import { aboveUsual, sobraPaths } from "../src/domain/sobra-paths.ts";

const R = (reais: number) => BigInt(Math.round(reais * 100));
// Entra 10.000 todo mês; sai 8.050 (3x), 9.800, 10.800, 9.800.
// Saída total 54.550,00 / 6 = 9.091,666… → 9.091,66 (trunca).
// Sobra = 10.000,00 − 9.091,66 = 908,34.
const outs = [8050, 8050, 8050, 9800, 10800, 9800];
const fixed = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"].map((month, i) => ({
  month,
  in: R(10000),
  out: R(outs[i]),
}));

test("averageFlows: média de saída trunca em centavos; sobra = média de entrada − média de saída", () => {
  assert.deepEqual(averageFlows(fixed), { avgIn: R(10000), avgOut: 909166n, kept: 90834n });
  assert.equal(averageFlows([]), null);
  // Negativos: entra 100,00 / sai 100,01 e entra 100,00 / sai 99,98.
  assert.deepEqual(averageFlows([{ month: "a", in: 10000n, out: 10001n }, { month: "b", in: 10000n, out: 9998n }]), {
    avgIn: 10000n,
    avgOut: 9999n,
    kept: 1n,
  });
});

test("Panorama, sobra_atual (sobraPaths) e acima_do_normal: o mesmo número na mesma população", () => {
  const input = { months: fixed, categories: [], protectedNames: new Set<string>(), currentMonth: "2026-11" };
  const panorama = monthSummary(fixed, "2026-11")!;
  const paths = sobraPaths({ ...input, target: { cents: 0n } })!;
  const above = aboveUsual(input)!;
  for (const r of [paths, above]) {
    assert.equal(r.kept, 90834n);
    assert.equal(r.avgOut, 909166n);
  }
  assert.equal(panorama.keptAvg, 90834n);
  assert.equal(panorama.avgOut, 909166n);
});

test("populações diferentes não precisam bater: uma compra pendente só entra numa delas", () => {
  // Mesma casa; a leitura do Panorama inclui uma pendente de 600,00 em outubro.
  const withPending = fixed.map((m) => (m.month === "2026-10" ? { ...m, out: m.out + R(600) } : m));
  const confirmed = averageFlows(fixed)!;
  const panorama = averageFlows(withPending)!;
  // 600,00 / 6 = 100,00 de diferença na sobra média.
  assert.equal(confirmed.kept - panorama.kept, R(100));
});
