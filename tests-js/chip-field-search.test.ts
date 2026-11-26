import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultActive, norm, searchChips, type ChipItem } from "../app/ds/chip-field-search.ts";

const items: ChipItem[] = [
  { id: "a", name: "Vestuário" },
  { id: "b", name: "Presentes" },
  { id: "c", name: "Cosméticos" },
];

test("norm ignores case, accents and outer spaces", () => {
  assert.equal(norm("  VESTUÁRIO "), "vestuario");
});

test("empty query lists every item and offers no create", () => {
  const s = searchChips(items, "");
  assert.equal(s.options.length, 3);
  assert.equal(s.exact, undefined);
  assert.equal(defaultActive(s, ""), -1);
});

test("filter matches without accents or case", () => {
  const s = searchChips(items, "vestuar");
  const names = s.options.map((o) => (o.kind === "item" ? o.item.name : "criar"));
  assert.deepEqual(names, ["Vestuário", "criar"]);
});

test("an existing name highlights it and never offers create", () => {
  const s = searchChips(items, "vestuário");
  assert.equal(s.exact?.id, "a");
  assert.ok(s.options.every((o) => o.kind === "item"));
  assert.equal(defaultActive(s, "vestuário"), 0);
});

test("a new name offers create with the trimmed text, active by default", () => {
  const s = searchChips(items, "  Viagens ");
  const last = s.options[s.options.length - 1];
  assert.deepEqual(last, { kind: "create", name: "Viagens" });
  assert.equal(defaultActive(s, "  Viagens "), s.options.length - 1);
});

test("validate error blocks create", () => {
  const s = searchChips(items, "x".repeat(130), () => "Muito longo.");
  assert.equal(s.error, "Muito longo.");
  assert.ok(s.options.every((o) => o.kind === "item"));
});
