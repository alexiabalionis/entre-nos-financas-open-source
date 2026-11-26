import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyBody,
  canConfirm,
  changeText,
  decisionLabels,
  endBody,
  entryMonth,
  isStale,
  monthsText,
  newAmount,
  pendingCount,
  pendingText,
  previewRows,
  versionsOf,
  type Preview,
  type PreviewEntry,
  type PreviewGroups,
} from "../app/fixed/preview-model.ts";
import { previewCopy, previewDone } from "../app/fixed/preview-copy.ts";

const entry = (id: string, date: string, version = 1): PreviewEntry => ({
  occurrence_id: "o-" + id,
  occurrence_date: date,
  monthly_item_id: id,
  version,
});

const groups: PreviewGroups = {
  replaced: [entry("a", "2026-11-15"), entry("b", "2027-02-15", 2), entry("c", "2027-05-15")],
  edited: [entry("j", "2027-01-15", 4), entry("k", "2027-04-15", 5)],
  preserved: [entry("p", "2026-12-15", 7)],
  cancelled: [entry("x", "2027-03-15", 9)],
};
const preview: Preview = { recurrence_id: "r1", from: "2026-11-15", groups };

test("grupos da prévia viram linhas com contagem, tom e meses", () => {
  const rows = previewRows(groups, "next", "De R$ 612,00 para R$ 640,00.");
  assert.deepEqual(
    rows.map((r) => [r.group, r.count, r.tone]),
    [
      ["replaced", 3, "accent"],
      ["preserved", 1, "ok"],
      ["cancelled", 1, "neutral"],
      ["edited", 2, "warn"],
    ],
  );
  assert.equal(rows[0].title, "serão atualizadas");
  assert.equal(
    rows[0].detail,
    "Novembro de 2026, fevereiro de 2027 e maio de 2027. De R$ 612,00 para R$ 640,00.",
  );
  assert.equal(rows[1].title, "já paga ou conciliada, fica como está");
  assert.equal(rows[2].title, "pulada, continua pulada");
  assert.equal(rows[3].detail, "Decida uma por uma. Nada muda nelas sem a sua escolha.");
});

test("encerrar fala em sair do plano e não repete o valor novo", () => {
  const rows = previewRows(groups, "end", "De R$ 1,00 para R$ 2,00.");
  assert.equal(rows[0].title, "saem do plano");
  assert.doesNotMatch(rows[0].detail, /De R\$/);
});

test("grupos vazios não aparecem e o singular concorda", () => {
  const only: PreviewGroups = { replaced: [entry("a", "2026-11-15")], edited: [], preserved: [], cancelled: [] };
  const rows = previewRows(only, "end");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "sai do plano");
});

test("confirmar só habilita com todas as ajustadas decididas", () => {
  assert.equal(pendingCount(groups, {}), 2);
  assert.equal(canConfirm(groups, {}), false);
  assert.equal(canConfirm(groups, { j: "keep" }), false);
  assert.equal(pendingText(groups, { j: "keep" }), "Falta decidir 1 conta ajustada para confirmar.");
  assert.equal(pendingText(groups, {}), "Falta decidir 2 contas ajustadas para confirmar.");
  assert.equal(canConfirm(groups, { j: "keep", k: "replace" }), true);
  assert.equal(pendingText(groups, { j: "keep", k: "replace" }), "Tudo decidido. Pode confirmar.");
});

test("sem ajuste à mão, confirmar já está liberado", () => {
  const clean = { ...groups, edited: [] };
  assert.equal(canConfirm(clean, {}), true);
  assert.equal(pendingText(clean, {}), "Pode confirmar.");
});

test("versões vêm de substituídas, editadas e preservadas, nunca das canceladas", () => {
  assert.deepEqual(versionsOf(groups), { a: 1, b: 2, c: 1, j: 4, k: 5, p: 7 });
});

test("corpo do apply: valor novo, decisões só das editadas e versões", () => {
  const body = applyBody(preview, 64000, { j: "keep", k: "replace", zzz: "keep" });
  assert.deepEqual(body, {
    recurrence_id: "r1",
    from: "2026-11-15",
    changes: { expected_cents: 64000 },
    decisions: { j: "keep", k: "replace" },
    versions: { a: 1, b: 2, c: 1, j: 4, k: 5, p: 7 },
  });
});

test("corpo do end: sem changes, com decisões e versões", () => {
  const body = endBody(preview, { j: "replace", k: "keep" });
  assert.deepEqual(Object.keys(body).sort(), ["decisions", "from", "recurrence_id", "versions"]);
  assert.deepEqual(body.decisions, { j: "replace", k: "keep" });
});

test("botões de decisão mudam de texto ao encerrar", () => {
  assert.deepEqual(decisionLabels("next"), { keep: "Manter meu ajuste", replace: "Usar o novo valor" });
  assert.deepEqual(decisionLabels("end"), { keep: "Manter no plano", replace: "Remover do plano" });
});

test("valor novo inválido bloqueia em vez de virar zero ou vazio", () => {
  assert.deepEqual(newAmount("640,00"), { cents: 64000 });
  assert.deepEqual(newAmount("1.234,56"), { cents: 123456 });
  for (const bad of ["", "   ", "0,00", "-5,00", "abc", "640"])
    assert.ok("error" in newAmount(bad), bad);
});

test("texto do valor: de/para, vazio se o valor novo não vale", () => {
  assert.equal(changeText("61200", { cents: 64000 }, "BRL", false), "De R$ 612,00 para R$ 640,00.");
  assert.equal(changeText("61200", { error: "x" }, "BRL", false), "");
  assert.equal(changeText(null, { cents: 64000 }, "BRL", false), "");
});

test("versão desatualizada é reconhecida pela mensagem do servidor", () => {
  assert.equal(
    isStale("A previsão mudou desde a prévia. Veja a prévia de novo antes de confirmar."),
    true,
  );
  assert.equal(isStale("Decida o que fazer com cada ocorrência editada à mão."), false);
});

test("meses sem repetir, no máximo seis", () => {
  assert.equal(monthsText([entry("a", "2026-11-01"), entry("b", "2026-11-02")]), "Novembro de 2026");
  const many = Array.from({ length: 8 }, (_, i) => entry("m" + i, `2027-0${i + 1}-10`));
  assert.match(monthsText(many), /e mais 2 meses$/);
  assert.equal(entryMonth(entry("a", "2027-01-15")), "Janeiro de 2027");
});

test("textos do diálogo por modo", () => {
  const s = { label: "Condomínio", month: "2026-11-01", from: "2026-11-15" };
  assert.deepEqual(previewCopy("next", s), {
    title: "Esta e as próximas",
    intro: "Vale para Condomínio a partir de 15/11/2026, incluindo esta. O que já passou não muda.",
    confirm: "Atualizar esta e as próximas",
  });
  const end = previewCopy("end", { ...s, end: "2026-11-14" });
  assert.equal(end.title, "Encerrar Condomínio");
  assert.equal(end.confirm, "Encerrar em 14/11/2026");
  assert.equal(end.intro, "Condomínio vale até 14/11/2026. Depois disso deixa de ser criado. O que já passou não muda.");
});

test("aviso de sucesso conta o que mudou e o que ficou", () => {
  const s = { label: "Condomínio", month: "2026-11-01", from: "2026-11-15" };
  assert.equal(
    previewDone("next", s, groups, { j: "keep", k: "replace" }),
    "Pronto. 4 contas atualizadas. 1 ajuste seu mantido. As contas pagas e as puladas ficaram como estavam.",
  );
  assert.equal(
    previewDone("end", { ...s, end: "2026-11-14" }, groups, {}),
    "Condomínio encerrado em 14/11/2026. As contas já pagas ficaram no histórico.",
  );
});
