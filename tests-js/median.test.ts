import { test } from "node:test";
import assert from "node:assert/strict";
import { median } from "../src/domain/median.ts";
import {
  NO_REFERENCE,
  referenceView,
  suggestedCeiling,
} from "../app/budgets/budget-reference-model.ts";

test("mediana: ímpar, par (média inteira), um valor e sem alterar a entrada", () => {
  const input = [30n, 10n, 20n];
  assert.equal(median(input), 20n);
  assert.deepEqual(input, [30n, 10n, 20n]);
  assert.equal(median([10n, 20n, 31n, 40n]), 25n);
  assert.equal(median([10n, 21n]), 15n);
  assert.equal(median([7n]), 7n);
});

test("mediana de lista vazia lança erro", () => {
  assert.throws(() => median([]), RangeError);
});

const fmt = (c: bigint) => `R$ ${c / 100n}`;

test("sugestão arredonda para cima em R$ 10", () => {
  assert.equal(suggestedCeiling(141320n), 142000n);
  assert.equal(suggestedCeiling(142000n), 142000n);
  assert.equal(suggestedCeiling(142001n), 143000n);
  assert.equal(suggestedCeiling(1n), 1000n);
  assert.equal(suggestedCeiling(0n), 0n);
});

test("textos: com histórico e sem histórico suficiente", () => {
  const ok = referenceView(
    {
      median_cents: "141320",
      max_cents: "198000",
      months: [1, 2, 3, 4, 5, 6].map((n) => ({ month: `2026-0${n}`, cents: "1" })),
    },
    fmt,
  );
  assert.equal(
    ok.text,
    "Nos últimos 6 meses, o normal foi R$ 1420 por mês (o maior foi R$ 1980).",
  );
  assert.equal(ok.suggestion, 142000n);
  const none = { text: NO_REFERENCE, suggestion: null };
  assert.deepEqual(referenceView(null, fmt), none);
  assert.deepEqual(
    referenceView({ median_cents: null, max_cents: null, months: [] }, fmt),
    none,
  );
});
