import { test } from "node:test";
import assert from "node:assert/strict";
import { NO_CATEGORY, outliers, uncategorized } from "../src/domain/data-warnings.ts";
import type { Purchase } from "../src/domain/spend-patterns-core.ts";

let seq = 0;
const buy = (p: Partial<Purchase> & { cents: bigint; date: string }): Purchase => ({
  id: `p${seq++}`,
  label: "Loja",
  category: "Outras",
  tag: "Sem etiqueta",
  account: "Corrente",
  payment: "debito",
  type: "avulso",
  essential: false,
  ...p,
});
const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

test("sem categoria: Pix agrupa por destinatário opaco, o resto por lugar", () => {
  const recipients = new Map<string, string>();
  const list: Purchase[] = [];
  for (let i = 0; i < 30; i++) {
    const p = buy({ cents: BigInt((i % 3) + 1) * 10000n, date: `${months[i % 6]}-10`, category: NO_CATEGORY, label: "Pix enviado" });
    recipients.set(p.id!, `d${i % 3}`);
    list.push(p);
  }
  list.push(buy({ cents: 5000n, date: "2026-10-11", category: NO_CATEGORY, label: "Padaria Ze" }));
  const out = uncategorized(list, recipients);
  assert.equal(out.count, 31);
  assert.equal(out.cents, 600000n + 5000n);
  const pix = out.groups.filter((g) => g.recipient !== null);
  assert.deepEqual(pix.map((g) => [g.recipient, g.count, g.cents]), [["d2", 10, 300000n], ["d1", 10, 200000n], ["d0", 10, 100000n]]);
  assert.equal(out.groups.find((g) => g.place === "Padaria Ze")?.count, 1);
});

test("fora da curva: câmera de 8.700 em Outras de 200 por mês; mês sem ela volta a 200", () => {
  const list = months.map((m) => buy({ cents: 20000n, date: `${m}-05` }));
  list.push(buy({ cents: 870000n, date: "2026-07-20", label: "Camera" }));
  const out = outliers(list, new Map());
  assert.equal(out.length, 1);
  assert.equal(out[0]!.month, "2026-07");
  assert.equal(out[0]!.withoutItCents, 20000n);
  assert.equal(out[0]!.normalCents, 20000n);
  assert.equal(out[0]!.label, "Camera");
});

test("fora da curva: categoria que sobe por frequência, fixa e parcela não geram aviso", () => {
  const list = months.flatMap((m, k) => Array.from({ length: 2 * (k + 1) }, (_, j) => buy({ cents: 5000n, date: `${m}-${String(j + 1).padStart(2, "0")}` })));
  assert.deepEqual(outliers(list, new Map()), []);
  const big = [...months.map((m) => buy({ cents: 20000n, date: `${m}-05` })), buy({ cents: 870000n, date: "2026-07-20", type: "parcela" })];
  assert.deepEqual(outliers(big, new Map()), []);
  assert.deepEqual(outliers(months.map((m) => buy({ cents: 870000n, date: `${m}-05`, type: "fixa" })), new Map()), []);
});

test("fora da curva: rótulo de Pix leva o destinatário opaco", () => {
  const list = months.map((m) => buy({ cents: 20000n, date: `${m}-05` }));
  const pix = buy({ cents: 870000n, date: "2026-07-20", label: "Pix enviado" });
  list.push(pix);
  assert.equal(outliers(list, new Map([[pix.id!, "d4"]]))[0]!.label, "Pix enviado (d4)");
});
