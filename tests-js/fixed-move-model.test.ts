import { test } from "node:test";
import assert from "node:assert/strict";
import {
  asksDue,
  dueError,
  dueReady,
  monthBounds,
  moveHint,
  movePayload,
  movedNotice,
  moveReady,
  moveTargets,
} from "../app/fixed/fixed-move-model.ts";

const item = { id: "i1", version: 3, month: "2026-11-01", due_date: "2026-11-15" };

test("destinos: meses seguintes e anteriores, nunca o mês atual", () => {
  const targets = moveTargets("2026-11-01");
  assert.equal(targets[0].value, "2026-12");
  assert.equal(targets[0].label, "Dezembro de 2026");
  assert.equal(targets.some((t) => t.value === "2026-11"), false);
  assert.equal(targets.some((t) => t.value === "2026-10"), true);
});

test("limites do mês, inclusive fevereiro de ano bissexto", () => {
  assert.deepEqual(monthBounds("2026-11"), { first: "2026-11-01", last: "2026-11-30" });
  assert.equal(monthBounds("2028-02").last, "2028-02-29");
});

test("vencimento fora do mês é recusado sem oferecer mudar o mês", () => {
  const error = dueError("2026-12-05", "2026-11");
  assert.equal(
    error,
    "Esse dia fica fora de novembro de 2026. Escolha uma data entre 01/11/2026 e 30/11/2026.",
  );
  assert.doesNotMatch(error ?? "", /mudar o mês|competência/i);
  assert.equal(dueError("2026-11-20", "2026-11"), null);
  assert.equal(dueError("", "2026-11"), null);
  assert.equal(dueReady("2026-12-05", "2026-11"), false);
  assert.equal(dueReady("", "2026-11"), false);
  assert.equal(dueReady("2026-11-20", "2026-11"), true);
});

test("mudar o mês pede vencimento novo ou Sem vencimento", () => {
  const pick = { month: "2026-12", dueMode: "pick" as const, due: "" };
  assert.equal(moveReady(pick, item), false);
  assert.match(moveHint(pick, item) ?? "", /Sem vencimento/);
  assert.equal(moveReady({ ...pick, due: "2027-01-05" }, item), false);
  assert.equal(moveReady({ ...pick, due: "2026-12-05" }, item), true);
  assert.equal(moveHint({ ...pick, due: "2026-12-05" }, item), null);
  assert.equal(moveReady({ ...pick, dueMode: "none" }, item), true);
});

test("conta sem vencimento não pergunta do vencimento", () => {
  const bare = { ...item, due_date: null };
  assert.equal(asksDue(bare), false);
  assert.equal(moveReady({ month: "2026-12", dueMode: "pick", due: "" }, bare), true);
  assert.equal(
    movePayload(bare, { month: "2026-12", dueMode: "pick", due: "2026-12-05" }).due_date,
    null,
  );
});

test("corpo do move: vencimento escolhido ou null", () => {
  assert.deepEqual(
    movePayload(item, { month: "2026-12", dueMode: "pick", due: "2026-12-05" }),
    { item_id: "i1", version: 3, month: "2026-12", due_date: "2026-12-05" },
  );
  assert.equal(
    movePayload(item, { month: "2026-12", dueMode: "none", due: "2026-12-05" }).due_date,
    null,
  );
});

test("aviso do move cita o mês novo", () => {
  assert.equal(
    movedNotice("Condomínio", "2026-12"),
    "Condomínio agora conta em dezembro. O mês de origem não cria outra no lugar.",
  );
});
