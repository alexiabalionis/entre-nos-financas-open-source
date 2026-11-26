import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonthCache } from "../app/hooks/month-cache.ts";

test("só devolve dados para o mesmo dono, mês e moeda", () => {
  const cache = createMonthCache<string, string>();
  assert.ok(cache.commit(cache.begin(), "a@x", "2026-11", "BRL", "dados", "proj"));
  assert.deepEqual(cache.read("a@x", "2026-11", "BRL"), {
    data: "dados",
    projection: "proj",
    stale: false,
  });
  assert.equal(cache.read("b@x", "2026-11", "BRL"), null);
  assert.equal(cache.read("a@x", "2026-12", "BRL"), null);
  assert.equal(cache.read("a@x", "2026-11", "USD"), null);
});

test("outra pessoa nunca enxerga o slot, mesmo sem clear()", () => {
  const cache = createMonthCache<string, string>();
  cache.commit(cache.begin(), "a@x", "2026-11", "BRL", "da-a", null);
  assert.equal(cache.read("b@x", "2026-11", "BRL"), null);
});

test("resposta velha não sobrescreve a mais nova, em qualquer ordem de chegada", () => {
  const cache = createMonthCache<string, string>();
  const slow = cache.begin();
  const fast = cache.begin();
  assert.ok(cache.commit(fast, "a@x", "2026-11", "BRL", "nova", null));
  assert.equal(cache.commit(slow, "a@x", "2026-11", "BRL", "velha", null), false);
  assert.equal(cache.read("a@x", "2026-11", "BRL")?.data, "nova");
});

test("clear() esvazia e invalida buscas que ainda estavam em voo", () => {
  const cache = createMonthCache<string, string>();
  cache.commit(cache.begin(), "a@x", "2026-11", "BRL", "da-a", null);
  const inFlight = cache.begin();
  cache.clear();
  assert.equal(cache.read("a@x", "2026-11", "BRL"), null);
  // A resposta da pessoa anterior chega depois do logout: é descartada.
  assert.equal(cache.commit(inFlight, "a@x", "2026-11", "BRL", "atrasada", null), false);
  assert.equal(cache.read("a@x", "2026-11", "BRL"), null);
  // Buscas abertas depois do clear() voltam a gravar normalmente.
  assert.ok(cache.commit(cache.begin(), "b@x", "2026-11", "BRL", "da-b", null));
  assert.equal(cache.read("b@x", "2026-11", "BRL")?.data, "da-b");
});

test("markStale() mantém os dados e avisa para rebuscar; uma busca nova limpa a marca", () => {
  const cache = createMonthCache<string, string>();
  cache.commit(cache.begin(), "a@x", "2026-11", "BRL", "v1", null);
  cache.markStale();
  assert.equal(cache.read("a@x", "2026-11", "BRL")?.stale, true);
  assert.equal(cache.read("a@x", "2026-11", "BRL")?.data, "v1");
  cache.commit(cache.begin(), "a@x", "2026-11", "BRL", "v2", null);
  assert.equal(cache.read("a@x", "2026-11", "BRL")?.stale, false);
});

test("markStale() sem slot não faz nada", () => {
  const cache = createMonthCache<string, string>();
  cache.markStale();
  assert.equal(cache.read("a@x", "2026-11", "BRL"), null);
});
