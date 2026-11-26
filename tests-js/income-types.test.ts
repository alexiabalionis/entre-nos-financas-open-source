import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyIncome, incomeOrigin, structuralSobra, type IncomeRow } from "../src/domain/income-types.ts";

const MONTHS = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const row = (id: string, month: string, reais: number, description: string, kind = "income"): IncomeRow => ({
  id,
  month,
  cents: BigInt(Math.round(reais * 100)),
  kind,
  description,
});
const base = { accountNames: ["Nubank Conta"], memberNames: ["Beatriz Fictícia Lima"], linkedIds: new Set<string>() };
const groupOf = (rows: ReturnType<typeof classifyIncome>, id: string) => rows.find((r) => r.id === id)!.group;

test("origem: sem Pix/TED, recebido, números nem acento", () => {
  assert.equal(incomeOrigin("PIX RECEBIDO Empresa Fictícia 123"), "empresa ficticia");
  assert.equal(incomeOrigin("TED de Cliente Ltda CNPJ 12.345"), "cliente ltda");
  assert.equal(incomeOrigin("PIX 123"), "");
});

test("salário em 6/6 meses é recorrente; freelas de origens diferentes são avulsas", () => {
  const salary = MONTHS.map((m, i) => row(`s${i}`, m, i % 2 ? 6100 : 5900, "Salario Empresa Fictícia"));
  const freelas = MONTHS.slice(0, 4).map((m, i) => row(`f${i}`, m, 2500, `PIX RECEBIDO Cliente ${"ABCD"[i]}ltda`));
  const out = classifyIncome({ ...base, entries: [...salary, ...freelas] });
  for (const r of salary) assert.equal(groupOf(out, r.id), "recorrente");
  for (const r of freelas) assert.equal(groupOf(out, r.id), "avulsa");
});

test("mesma origem em 3 meses com 1.000/1.000/2.000 fica fora de ±20%: avulsa", () => {
  const entries = [row("a", "2026-01", 1000, "Aluguel Casa Fictícia"), row("b", "2026-02", 1000, "Aluguel Casa Fictícia"), row("c", "2026-03", 2000, "Aluguel Casa Fictícia")];
  assert.deepEqual(classifyIncome({ ...base, entries }).map((r) => r.group), ["avulsa", "avulsa", "avulsa"]);
  const steady = [...entries.slice(0, 2), row("d", "2026-03", 1150, "Aluguel Casa Fictícia")];
  assert.deepEqual(classifyIncome({ ...base, entries: steady }).map((r) => r.group), ["recorrente", "recorrente", "recorrente"]);
});

test("resgate, conta da casa e nome do membro são suspeitas mesmo lançados como income", () => {
  const entries = [
    row("r", "2026-01", 3000, "RESGATE RDB"),
    row("m", "2026-01", 1500, "PIX RECEBIDO Beatriz Fictícia Lima"),
    row("c", "2026-02", 800, "TRANSF Nubank Conta"),
    row("y", "2026-02", 10, "Rendimento", "yield"),
  ];
  const out = classifyIncome({ ...base, entries });
  assert.deepEqual(out.map((r) => [r.group, r.reason]), [
    ["suspeita_dinheiro_proprio", "investimento"],
    ["suspeita_dinheiro_proprio", "nome_da_casa"],
    ["suspeita_dinheiro_proprio", "conta_da_casa"],
    ["rendimento", null],
  ]);
});

test("entrada ligada a regra de renda é recorrente; sobra estrutural usa só a recorrente", () => {
  const salary = MONTHS.map((m, i) => row(`s${i}`, m, 6000, "Salario"));
  const freela = row("f", "2026-02", 2500, "Cliente Avulso");
  const linked = classifyIncome({ ...base, entries: [freela], linkedIds: new Set(["f"]) });
  assert.equal(linked[0]!.group, "recorrente");
  const out = classifyIncome({ ...base, entries: [...salary, freela] });
  const s = structuralSobra({ rows: out, months: 6, avgOut: 700000n });
  assert.equal(s.kept, -100000n);
  assert.equal(s.pct, -16.6);
  assert.equal(structuralSobra({ rows: [], months: 6, avgOut: 5n }).pct, null);
});

test("uma entrada diferente da mesma origem fica avulsa sozinha, sem derrubar as que se repetem (caso real de 23/11/2026)", () => {
  const repeated = ["2026-04", "2026-05", "2026-06"].map((m, i) => row(`r${i}`, m, 10000, "PIX RECEBIDO Origem Fictícia"));
  const odd = row("odd", "2026-06", 450, "PIX RECEBIDO Origem Fictícia");
  const out = classifyIncome({ ...base, entries: [...repeated, odd] });
  for (const r of repeated) assert.equal(groupOf(out, r.id), "recorrente", r.id);
  assert.equal(groupOf(out, "odd"), "avulsa");
});

test("mês típico: a mediana ignora um mês fora da curva que puxa a média; o mês aparece pelo nome", async () => {
  const { typicalMonth } = await import("../src/domain/income-types.ts");
  const m = (month: string, inR: number, outR: number) => ({ month, in: BigInt(inR * 100), out: BigInt(outR * 100) });
  const months = [m("2026-04", 10000, 9000), m("2026-05", 10000, 9500), m("2026-06", 10000, 9200), m("2026-07", 10000, 56000), m("2026-08", 10000, 9100)];
  const t = typicalMonth(months)!;
  assert.equal(t.saidaMediana, 920000n);
  assert.equal(t.sobraMediana, 80000n);
  assert.deepEqual(t.foraDaCurva, [{ month: "2026-07", out: 5600000n }]);
  assert.equal(typicalMonth([]), null);
});
