import { test } from "node:test";
import assert from "node:assert/strict";
import { barGeometry, usedLayers } from "../app/ds/stacked-bars-model.ts";

const values = [
  [100, 50],
  [200, 100],
  [0, 40],
];
const base = { width: 300, height: 200, top: 20, bottom: 190, minColumnWidth: 46 };

test("barGeometry: totais, máximo e retângulos", () => {
  const g = barGeometry({ values, ...base });
  assert.deepEqual(g.totals, [150, 300, 40]);
  assert.equal(g.max, 300);
  assert.equal(g.rects.length, 5);
  assert.equal(g.col, 100);
  assert.equal(g.barW, 44);
});

test("barGeometry: camadas empilham a partir da base", () => {
  const g = barGeometry({ values, ...base });
  const low = g.rects.find((r) => r.col === 1 && r.layer === 0)!;
  const up = g.rects.find((r) => r.col === 1 && r.layer === 1)!;
  assert.ok(Math.abs(low.y + low.h - base.bottom) < 1e-9);
  assert.ok(Math.abs(up.y + up.h - low.y) < 1e-9);
  assert.ok(Math.abs(up.y - base.top) < 1e-9);
});

test("barGeometry: ghost maior define o máximo", () => {
  const g = barGeometry({ values, ghost: [null, 500, null], ...base });
  assert.equal(g.max, 500);
});

test("barGeometry: respeita a largura mínima por coluna e ignora valor <= 0.5", () => {
  const g = barGeometry({ values: [[0.4], [1], [1], [1]], ...base, width: 100 });
  assert.equal(g.width, 184);
  assert.equal(g.rects.length, 3);
  assert.equal(barGeometry({ values: [[0]], ...base }).max, 1);
});

test("usedLayers", () => {
  assert.deepEqual(usedLayers([[0, 1, 0], [0, 0, 0]], 3), [false, true, false]);
});
