import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APP_ROUTES,
  legacyViewPath,
  titleFor,
  withMonth,
} from "../app/shell/routes.ts";

test("links antigos ?view= apontam para a rota nova (inclui future -> panorama)", () => {
  assert.equal(legacyViewPath("month"), "/");
  assert.equal(legacyViewPath("movements"), "/movimentos");
  assert.equal(legacyViewPath("future"), "/panorama");
  assert.equal(legacyViewPath("panorama"), "/panorama");
  assert.equal(legacyViewPath("copiloto"), "/copiloto");
  assert.equal(legacyViewPath("help"), "/judite");
  assert.equal(legacyViewPath("us"), "/espaco");
  assert.equal(legacyViewPath("desconhecida"), null);
  assert.equal(legacyViewPath(undefined), null);
  assert.equal(legacyViewPath("constructor"), null);
});

test("títulos e barra de baixo: 5 itens na ordem antiga, Nosso espaço fora da barra", () => {
  assert.deepEqual(
    APP_ROUTES.filter((r) => r.nav).map((r) => r.nav!.label),
    ["Mês", "Movimentos", "Panorama", "Copiloto", "Judite"],
  );
  assert.equal(titleFor("/espaco"), "Nosso espaço");
  assert.equal(titleFor("/movimentos"), "Movimentos");
  assert.equal(titleFor("/qualquer"), "Nosso mês");
});

test("withMonth mantém o mês e acrescenta parâmetros extras", () => {
  assert.equal(withMonth("/", "2026-11"), "/?month=2026-11");
  assert.equal(
    withMonth("/espaco", "2026-11", { painel: "bancos", conta: "abc" }),
    "/espaco?month=2026-11&painel=bancos&conta=abc",
  );
});
