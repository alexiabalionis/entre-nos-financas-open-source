import { test } from "node:test";
import assert from "node:assert/strict";
import { eventName } from "../src/domain/event-name.ts";

test("sem apelido devolve a descrição", () => {
  assert.equal(eventName({ description: "PIX MERCADO" }), "PIX MERCADO");
});

test("com apelido devolve o apelido", () => {
  assert.equal(eventName({ display_name: "Mercado", description: "PIX MERCADO" }), "Mercado");
});

test("string vazia ou só espaços cai para a descrição", () => {
  assert.equal(eventName({ display_name: "", description: "PIX MERCADO" }), "PIX MERCADO");
  assert.equal(eventName({ display_name: "   ", description: "PIX MERCADO" }), "PIX MERCADO");
});

test("null e undefined caem para a descrição", () => {
  assert.equal(eventName({ display_name: null, description: "PIX MERCADO" }), "PIX MERCADO");
  assert.equal(eventName({ display_name: undefined, description: "PIX MERCADO" }), "PIX MERCADO");
});
