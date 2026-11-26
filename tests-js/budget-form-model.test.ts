import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CEILING_ERROR,
  ceilingError,
  ceilingInput,
  fromOptions,
  parseCeiling,
  removeBody,
  removeLabel,
  removePayload,
  removedNotice,
  savePayload,
  savedNotice,
  validFromText,
} from "../app/budgets/budget-form-model.ts";

const draft = { categoryId: "c1", from: "2026-12", value: "1.800,5" };

test("valor digitado vira centavos sem adivinhar", () => {
  assert.equal(parseCeiling("1.800,00"), 180000n);
  assert.equal(parseCeiling("1800"), 180000n);
  assert.equal(parseCeiling("1.800,5"), 180050n);
  assert.equal(parseCeiling(" 350 "), 35000n);
});

test("vazio, zero, negativo e formato inválido são bloqueados com o erro do campo", () => {
  for (const bad of ["", "   ", "0", "0,00", "-5", "abc", "1.5", "12,345", "1,8,0", "1.80.0"]) {
    assert.equal(parseCeiling(bad), null, bad);
    assert.equal(ceilingError(bad), CEILING_ERROR, bad);
  }
  assert.equal(ceilingError("10"), "");
});

test("payload de salvar leva o mês 'a partir de' e o valor no formato da rota", () => {
  assert.deepEqual(savePayload(draft, "BRL"), {
    category_id: "c1",
    month: "2026-12",
    currency: "BRL",
    planned: "1800,50",
  });
  assert.equal(savePayload({ ...draft, value: "" }, "BRL"), null);
});

test("payload de tirar o teto manda planned null a partir do mês escolhido", () => {
  assert.deepEqual(removePayload(draft, "BRL"), {
    category_id: "c1",
    month: "2026-12",
    currency: "BRL",
    planned: null,
  });
});

test("campo de edição mostra o teto com milhar", () => {
  assert.equal(ceilingInput(350000n), "3.500,00");
  assert.equal(ceilingInput(5n), "0,05");
  assert.equal(ceilingInput(123456789n), "1.234.567,89");
});

test("opções de 'Vale a partir de': este mês e os dois seguintes", () => {
  const o = fromOptions("2026-11");
  assert.deepEqual(o.map((x) => x.value), ["2026-11", "2026-12", "2027-01"]);
  assert.equal(o[0].label, "Novembro de 2026 (este mês)");
  assert.equal(o[2].label, "Janeiro de 2027");
});

test("textos de vigência, retirada e avisos", () => {
  assert.equal(
    validFromText("2026-11", "2026-11", null),
    "Vale de novembro de 2026 em diante. Segue valendo nos meses seguintes até você mudar.",
  );
  assert.equal(
    validFromText("2026-12", "2026-11", "R$ 3.500,00"),
    "Novembro continua com R$ 3.500,00. Vale de dezembro de 2026 em diante, e segue valendo nos meses seguintes até você mudar.",
  );
  assert.equal(validFromText("2026-12", "2026-11", null).startsWith("Novembro continua sem teto. "), true);
  assert.equal(removeLabel("2026-11", "2026-11"), "Tirar o teto a partir deste mês");
  assert.equal(removeLabel("2027-01", "2026-11"), "Tirar o teto a partir de janeiro de 2027");
  assert.match(removeBody("Moradia", "R$ 3.500,00", "2026-12", "2026-11"), /continua com o teto de R\$ 3\.500,00 até o fim de novembro/);
  assert.match(savedNotice("Moradia", "R$ 10,00", "2026-12", "2026-11"), /^Novembro continua como está\./);
  assert.equal(removedNotice("Moradia", "2026-11", "2026-11"), "Teto de Moradia retirado a partir de novembro de 2026.");
});
