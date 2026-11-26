import { test } from "node:test";
import assert from "node:assert/strict";
import type { FutureResult } from "../src/domain/future-months.ts";
import { purchaseLead, tightestLine, tightestMonth, verdictOf } from "../app/future/simulator-verdict.ts";

// Só o que o veredito lê: meses (mês e folga) e o nível do motor.
function result(free: number[], level: FutureResult["viability"]["level"] = "ok", start = "2026-11"): FutureResult {
  const [y, m] = start.split("-").map(Number);
  const rows = free.map((f, i) => {
    const t = y * 12 + (m - 1) + i;
    return { month: `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`, free: BigInt(f) * 100n };
  });
  return {
    rows,
    viability: { level, title: level === "apertado" ? "1 mês sem folga" : "Saldo em conta fica negativo", detail: "Detalhe do motor." },
  } as unknown as FutureResult;
}

test("tightestMonth: o mês de menor folga, o primeiro em empate", () => {
  assert.deepEqual(tightestMonth(result([500, 200, 200, 900]), 4), { month: "2026-12", free: 20000n });
  assert.equal(tightestMonth(result([]), 4), null);
});

test("tightestLine: mesmo ano só o nome; outro ano com o ano; negativo diz que sai do saldo", () => {
  assert.equal(tightestLine(result([500, 200]), 2), "No mês mais apertado, dezembro, ainda sobram R$ 200.");
  assert.equal(tightestLine(result([500, 900, 100]), 3), "No mês mais apertado, janeiro de 2027, ainda sobram R$ 100.");
  assert.equal(tightestLine(result([500, -80]), 2), "Em dezembro faltam R$ 80, que sairiam do saldo em conta.");
  assert.equal(tightestLine(result([500, 200]), 2, true), "No mês mais apertado, dezembro, ainda sobram ••••.");
});

test("verdictOf: a palavra vem do nível do motor; ok explica pelo mês mais apertado", () => {
  const v = verdictOf(result([500]), result([300]), 1, "A fatura sobe R$ 200 por 1 meses.");
  assert.equal(v.level, "ok");
  assert.equal(v.word, "Cabe.");
  assert.match(v.line, /^A fatura sobe .* ainda sobram R\$ 300\.$/);
  assert.equal(v.before, undefined);
  const tight = verdictOf(result([500]), result([-10], "apertado"), 1, "");
  assert.equal(tight.word, "Fica apertado.");
  assert.equal(tight.line, "1 mês sem folga. Detalhe do motor.");
  assert.equal(verdictOf(result([500]), result([-10], "inviavel"), 1, "").word, "Não cabe.");
});

test("verdictOf: se o plano já estava apertado, a mudança não leva a culpa", () => {
  const v = verdictOf(result([-5], "apertado"), result([-10], "apertado"), 1, "");
  assert.equal(v.before, "O plano de vocês já estava assim antes desta mudança.");
  assert.equal(verdictOf(result([5]), result([-10], "apertado"), 1, "").before, undefined);
});

test("purchaseLead: parcela arredondada para cima; à vista fala da fatura do mês", () => {
  assert.equal(purchaseLead(100000n, 3), "A fatura sobe R$ 334 por 3 meses.");
  assert.equal(purchaseLead(180000n, 1), "A fatura do mês sobe R$ 1.800.");
});

test("stillDismissed: escondida até o número principal mudar 20%", async () => {
  const { stillDismissed } = await import("../app/future/simulator-verdict.ts");
  const saved = { id: "rise-Pet", metric: 10000n };
  assert.equal(stillDismissed(10000n, undefined), false, "nunca escondida");
  assert.equal(stillDismissed(11900n, saved), true, "+19%: segue escondida");
  assert.equal(stillDismissed(12000n, saved), false, "+20%: volta");
  assert.equal(stillDismissed(8000n, saved), false, "−20%: volta");
  assert.equal(stillDismissed(undefined, saved), true);
  assert.equal(stillDismissed(5n, { id: "x", metric: null }), true);
});

test("historyCheck: acima da sobra média não cabe; dentro mas com mês curto fica apertado", async () => {
  const { historyCheck, partsText } = await import("../app/future/simulator-verdict.ts");
  // Sobra média R$ 970, meses fechados: 1.500, 1.200, 200 (um mês curto).
  const h = { avg: 97000n, kept: [{ month: "2026-08", cents: 150000n }, { month: "2026-09", cents: 120000n }, { month: "2026-10", cents: 20000n }] };
  assert.equal(historyCheck(83400n, h, 0n).level, "apertado", "R$ 834: cabe na média, mas em 1 mês sobrou menos");
  assert.match(partsText(historyCheck(83400n, h, 0n).parts), /Em 1 dos 3 meses fechados \(out\)/);
  assert.equal(historyCheck(500000n, h, 0n).level, "inviavel", "R$ 5.000 > R$ 970");
  assert.equal(historyCheck(10000n, h, 0n).level, "ok", "R$ 100 coube em todo mês");
  // Aportes que já estão no plano moram dentro da sobra: o espaço é a média menos eles.
  assert.equal(historyCheck(50000n, h, 60000n).level, "inviavel", "espaço = 970 − 600 = 370 < 500");
});

test("verdictOf com histórico: o pior entre plano e histórico vence", async () => {
  const { verdictOf } = await import("../app/future/simulator-verdict.ts");
  const h = { avg: 97000n, kept: [{ month: "2026-09", cents: 97000n }, { month: "2026-10", cents: 97000n }] };
  const v = verdictOf(result([700000]), result([600000]), 1, "", false, { commit: 500000n, history: h, planned: 0n });
  assert.equal(v.word, "Não cabe.", "o plano diz que cabe (R$ 6.000 de folga), o histórico não");
  assert.match(v.line, /costumam sobrar/);
});
