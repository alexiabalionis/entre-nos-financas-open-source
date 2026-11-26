import assert from "node:assert/strict";
import { test } from "node:test";
import { OMITTED_NOTE, REPAIR_EXPLANATION, UNVERIFIED, repairFallback } from "../src/domain/money-check.ts";

const x = UNVERIFIED;

test("conclusão na mesma frase seguinte vira explicação curta", () => {
  const r = repairFallback(`Delivery aumentou ${x}. Por isso, não é possível aumentar a reserva.`);
  assert.equal(r.kind, "replaced");
  assert.equal(r.text, REPAIR_EXPLANATION);
});

test("conclusão em outro parágrafo vira explicação curta", () => {
  const r = repairFallback(`Delivery aumentou ${x}.\n\nLazer ficou igual.\n\nPor isso, não dá para guardar mais.`);
  assert.equal(r.kind, "replaced");
  assert.equal(r.text, REPAIR_EXPLANATION);
});

test("uma afirmação inválida sustentando conclusões em lista", () => {
  const r = repairFallback(`O gasto subiu ${x}.\n\nConsequências:\n- Por isso a sobra caiu.\n- Então a meta de 10% fica difícil.`);
  assert.equal(r.kind, "replaced");
  assert.equal(r.text, REPAIR_EXPLANATION);
  assert.ok(!r.text.includes(x));
});

test("valor isolado sem conclusão só remove a frase", () => {
  const r = repairFallback(`Delivery aumentou ${x}. Lazer ficou igual.`);
  assert.equal(r.kind, "removed");
  assert.equal(r.text, "Lazer ficou igual.");
  assert.ok(!r.text.includes(x));
  assert.ok(OMITTED_NOTE.length > 0);
});

test("conclusão anterior à remoção não dispara a troca", () => {
  const r = repairFallback(`Você gastou menos, por isso sobrou. Delivery aumentou ${x}.`);
  assert.equal(r.kind, "removed");
  assert.equal(r.text, "Você gastou menos, por isso sobrou.");
});

test("só afirmações inválidas resulta em vazio", () => {
  const r = repairFallback(`Delivery aumentou ${x}.\n\nLazer caiu ${x}.`);
  assert.equal(r.kind, "empty");
  assert.equal(r.text, "");
});
