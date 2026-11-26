import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "../src/domain/day.ts";
import {
  brasiliaOf,
  categoryTotalCents,
  findPatterns,
  timeQuality,
  type Highlight,
  type PatternResult,
  type Purchase,
} from "../src/domain/spend-patterns.ts";
import { listDays } from "../src/domain/spend-patterns-core.ts";
import { weekdayOf } from "../src/domain/spend-patterns-time.ts";
import { PatternTrace, findingKey, overlapRelation, overlaps, selectionTrace } from "../src/domain/spend-patterns-trace.ts";

const M6 = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"];
const H1 = listDays("2026-01-01", "2026-03-31");
const H2 = listDays("2026-04-01", "2026-06-30");
const ALL = [...H1, ...H2];

const buy = (date: string, cents: number, v: Partial<Purchase> = {}): Purchase => ({
  date,
  cents: BigInt(cents),
  label: "Loja X",
  category: "Mercado",
  tag: "geral",
  account: "cc",
  payment: "debito",
  type: "avulso",
  essential: false,
  ...v,
});

const run = (purchases: Purchase[], extra: Partial<Parameters<typeof findPatterns>[0]> = {}): PatternResult =>
  findPatterns({ purchases, accountsTime: { cc: "sem_hora" }, salaryDates: [], months: M6, maxDestaques: 1000, ...extra });

const pick = (r: PatternResult, analise: Highlight["analise"], corte = "", tipo = "casa"): Highlight | undefined =>
  r.destaques.find((h) => h.analise === analise && h.recorte.tipo === tipo && h.corte.includes(corte));

const many = (dates: readonly string[], cents: number, v: Partial<Purchase> = {}) => dates.map((d) => buy(d, cents, v));
const spread = (days: readonly string[], n: number): string[] =>
  Array.from({ length: n }, (_, k) => days[Math.floor(((k + 0.5) * days.length) / n)]!);
const near = (a: number | undefined, b: number, eps = 0.01) => assert.ok(a !== undefined && Math.abs(a - b) < eps, `${a} != ${b}`);

// ---------- timeQuality e hora de Brasília ----------

const at = (day: number, hhmm: string) => `2026-02-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;

test("timeQuality: menos de 20 transações com hora é insuficiente", () => {
  assert.equal(timeQuality(Array.from({ length: 19 }, (_, k) => at(k + 1, "03:00"))), "insuficiente");
  assert.equal(timeQuality([null, undefined, ...Array.from({ length: 18 }, (_, k) => at(k + 1, "03:00"))]), "insuficiente");
});

test("timeQuality: 80% no mesmo horário é sem_hora, 75% é com_hora", () => {
  const same = (n: number, total: number) =>
    Array.from({ length: total }, (_, k) => at((k % 27) + 1, k < n ? "03:00" : `1${k % 9}:${10 + k}`));
  assert.equal(timeQuality(same(20, 20)), "sem_hora");
  assert.equal(timeQuality(same(16, 20)), "sem_hora");
  assert.equal(timeQuality(same(15, 20)), "com_hora");
});

test("brasiliaOf: 01h30Z é 22h30 do dia anterior em Brasília", () => {
  assert.deepEqual(brasiliaOf("2026-03-11T01:30:00Z"), { day: "2026-03-10", hour: 22, minute: 30 });
  assert.deepEqual(brasiliaOf("2026-03-11T00:00:00-03:00"), { day: "2026-03-11", hour: 0, minute: 0 });
  assert.equal(brasiliaOf("lixo"), null);
});

// ---------- dados uniformes ----------

test("dados distribuídos por igual não geram destaque", () => {
  const r = run(many(ALL, 5000));
  assert.deepEqual(r.destaques, []);
  assert.equal(r.sem_padrao.aprovadas, 0);
  assert.ok(r.sem_padrao.avaliadas > 0);
  assert.equal(r.compras_analisadas, 181);
  assert.equal(r.ciclo_salario, false);
});

// ---------- análise 1: concentração no tempo ----------

const mondays = ALL.filter((d) => weekdayOf(d) === "segunda");

test("1: toda segunda tem índice 181/26 e alavanca corte_no_pico calculada à mão", () => {
  const r = run(many(mondays, 10000));
  assert.equal(mondays.length, 26);
  const h = pick(r, "concentracao_tempo", "dia_da_semana: segunda")!;
  near(h.indice!, 181 / 26, 0.001);
  near(h.metades![0], 90 / 13, 0.001);
  near(h.metades![1], 7, 0.001);
  assert.equal(h.base.corte_compras, 26);
  assert.equal(h.base.corte_cents, 260000n);
  // (260000 - 260000*26/181) / 6 = 37108,65 -> R$ 371
  assert.deepEqual(h.alavancas, [{ tipo: "corte_no_pico", cents: 37100n }]);
});

test("1: uma_a_menos_por_semana = valor médio x 52/12 com 1,5 compra por semana ou mais", () => {
  const extra = mondays.flatMap((d) => [buy(d, 10000), buy(d, 10000)]);
  const r = run([...many(ALL, 1000), ...extra]);
  const h = pick(r, "concentracao_tempo", "dia_da_semana: segunda")!;
  assert.equal(h.base.corte_compras, 78);
  // (546000 - 701000*26/181) / 6 = 74217,31
  assert.equal(h.alavancas.find((l) => l.tipo === "corte_no_pico")!.cents, 74200n);
  // 701000/233 * 52/12 = 13037,2
  assert.equal(h.alavancas.find((l) => l.tipo === "uma_a_menos_por_semana")!.cents, 13000n);
});

const MON5 = ["2026-01-05", "2026-01-12", "2026-01-19", "2026-04-06", "2026-04-13"];
const OTHERS = ["2026-01-06", "2026-01-07", "2026-01-10", "2026-04-02", "2026-04-03", "2026-04-05", "2026-04-08"];

test("1: limite de volume do recorte (11 compras não, 12 sim)", () => {
  assert.ok(pick(run(many([...MON5, ...OTHERS], 5000)), "concentracao_tempo", "dia_da_semana: segunda"));
  assert.equal(pick(run(many([...MON5, ...OTHERS.slice(0, 6)], 5000)), "concentracao_tempo", "dia_da_semana: segunda"), undefined);
});

test("1: limite de volume do corte (4 compras não, 5 sim)", () => {
  const four = [...MON5.slice(0, 4), "2026-04-14", ...OTHERS];
  assert.equal(pick(run(many(four, 5000)), "concentracao_tempo", "dia_da_semana: segunda"), undefined);
});

const weekendCase = (w0: number, w1: number): Purchase[] =>
  [H1, H2].flatMap((half, h) => {
    const isWeekend = (d: string) => ["sábado", "domingo"].includes(weekdayOf(d));
    const w = h === 0 ? w0 : w1;
    return many(
      [...spread(half.filter(isWeekend), w), ...spread(half.filter((d) => !isWeekend(d)), 20 - w)],
      5000,
    );
  });

test("1: limite de força 1,5 (17 de 40 no fim de semana é 1,48; 18 é 1,57)", () => {
  const axis = "dia_util_ou_fim_de_semana: fim de semana";
  assert.equal(pick(run(weekendCase(8, 9)), "concentracao_tempo", axis), undefined);
  const h = pick(run(weekendCase(9, 9)), "concentracao_tempo", axis)!;
  near(h.indice!, 0.45 / (52 / 181), 0.001);
});

test("1: um mês isolado não vira padrão (trava das duas metades)", () => {
  const h1 = ["2026-01-06", "2026-01-15", "2026-01-24", "2026-02-03", "2026-02-12", "2026-02-21", "2026-03-03", "2026-03-12", "2026-03-21"];
  const lone = ["2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25", "2026-06-01"];
  assert.equal(pick(run(many([...h1, ...lone], 5000)), "concentracao_tempo", "dia_da_semana: segunda"), undefined);
});

test("1: hora de Brasília define o dia e a faixa; 22h30 aparece como tarde da noite", () => {
  const late = mondays.map((d) => buy(addDays(d, 1), 10000, { at: `${addDays(d, 1)}T01:30:00Z` }));
  const r = run(late, { accountsTime: { cc: "com_hora" } });
  assert.equal(r.cobertura_hora, 1);
  assert.ok(pick(r, "concentracao_tempo", "dia_da_semana: segunda"));
  const band = pick(r, "concentracao_tempo", "hora_do_dia: tarde da noite")!;
  near(band.indice!, 12, 0.001);
  const cell = pick(r, "concentracao_tempo", "dia_da_semana_e_hora: segunda tarde da noite")!;
  near(cell.indice!, 181 / 26 / (2 / 24), 0.01);
});

test("1: conta sem_hora usa só a data e não gera padrão de hora", () => {
  const late = mondays.map((d) => buy(addDays(d, 1), 10000, { at: `${addDays(d, 1)}T01:30:00Z` }));
  const r = run(late, { accountsTime: { cc: "sem_hora" } });
  assert.equal(r.cobertura_hora, 0);
  assert.equal(pick(r, "concentracao_tempo", "hora_do_dia"), undefined);
  assert.ok(pick(r, "concentracao_tempo", "dia_da_semana: terça"));
});

test("1: cobertura de hora abaixo de 50% desliga os eixos de hora", () => {
  const withHour = mondays.map((d) => buy(addDays(d, 1), 4000, { at: `${addDays(d, 1)}T01:30:00Z`, account: "a" }));
  const noHour = mondays.map((d) => buy(addDays(d, 1), 6000, { account: "b" }));
  const r = run([...withHour, ...noHour], { accountsTime: { a: "com_hora", b: "sem_hora" } });
  near(r.cobertura_hora, 0.4, 0.0001);
  assert.equal(pick(r, "concentracao_tempo", "hora_do_dia"), undefined);
});

// ---------- análise 2: tendência ----------

const lazer = (olderPerMonth: number, recent: number[], cents: number, recentCents = cents): Purchase[] => {
  const days = [3, 9, 15, 21, 27];
  const dated = (months: string[], n: (k: number) => number) =>
    months.flatMap((m, k) => days.slice(0, n(k)).map((d) => `${m}-${String(d).padStart(2, "0")}`));
  const v = { category: "Lazer", label: "Cinema" };
  return [
    ...many(dated(["2026-01", "2026-02", "2026-03"], () => olderPerMonth), cents, v),
    ...many(dated(["2026-04", "2026-05", "2026-06"], (k) => recent[k]!), recentCents, v),
  ];
};

test("2: frequência dobra, valor médio igual: alta por frequência e alavanca voltar_ao_nivel_anterior", () => {
  const r = run(lazer(2, [4, 4, 4], 5000));
  const h = pick(r, "tendencia", "alta", "categoria")!;
  assert.match(h.corte, /frequência$/);
  assert.deepEqual(h.metades, [10000, 20000]);
  assert.equal(h.alavancas.find((l) => l.tipo === "voltar_ao_nivel_anterior")!.cents, 10000n);
});

test("2: limite de 25% (25% passa, 22,5% não)", () => {
  assert.ok(pick(run(lazer(4, [5, 5, 5], 5000)), "tendencia", "alta", "categoria"));
  assert.equal(pick(run(lazer(4, [5, 5, 5], 5000, 4900)), "tendencia", "", "categoria"), undefined);
});

test("2: um mês isolado alto na metade recente não vira tendência", () => {
  const spike = many(Array<string>(10).fill("2026-06-28"), 5000, { category: "Lazer", label: "Cinema" });
  assert.equal(pick(run([...lazer(2, [2, 2, 2], 5000), ...spike]), "tendencia", "", "categoria"), undefined);
});

// ---------- análise 3: lugares ----------

const placeCase = (counts: Array<[string, number, number]>): Purchase[] => {
  const dates0 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 29].map((d) => `2026-0${1 + (d % 3)}-${String(d).padStart(2, "0")}`);
  const dates1 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 29].map((d) => `2026-0${4 + (d % 3)}-${String(d).padStart(2, "0")}`);
  const labels = (half: 0 | 1) => counts.flatMap(([l, a, b]) => Array<string>(half === 0 ? a : b).fill(l));
  return [0, 1].flatMap((h) => labels(h as 0 | 1).map((l, k) => buy((h === 0 ? dates0 : dates1)[k]!, 5000, { label: l })));
};

test("3: três lugares com 60% do gasto (12 de 20) passam; 11 de 20 não", () => {
  const ok = placeCase([["A", 3, 2], ["B", 2, 2], ["C", 2, 1], ["D", 1, 1], ["E", 1, 1], ["F", 1, 1], ["G", 0, 2]]);
  const h = pick(run(ok), "lugares", "A, B, C", "categoria")!;
  near(h.indice!, 0.6, 0.0001);
  assert.deepEqual(h.metades, [0.7, 0.5]);
  const below = placeCase([["A", 3, 2], ["B", 2, 2], ["C", 1, 1], ["D", 1, 1], ["E", 1, 1], ["F", 1, 1], ["G", 1, 1], ["H", 0, 1]]);
  assert.equal(pick(run(below), "lugares", "", "categoria"), undefined);
});

test("3: lugares só rodam em categoria e etiqueta; casa, conta e pagamento não geram", () => {
  const ok = placeCase([["A", 3, 2], ["B", 2, 2], ["C", 2, 1], ["D", 1, 1], ["E", 1, 1], ["F", 1, 1], ["G", 0, 2]]);
  const kinds = new Set(run(ok).destaques.filter((h) => h.analise === "lugares").map((h) => h.recorte.tipo));
  assert.deepEqual([...kinds].sort(), ["categoria", "etiqueta"]);
});

test("3: Pix enviado e transferência nunca entram em lugares", () => {
  const r = run([...many(spread(ALL, 20), 5000, { label: "Pix enviado" }), ...many(spread(ALL, 20), 5000, { label: "Transferência recebida" })]);
  assert.equal(r.destaques.filter((h) => h.recorte.tipo === "lugar").length, 0);
  assert.equal(pick(r, "lugares"), undefined);
});

// ---------- análise 4: compras pequenas ----------

const smallCase = (start: number): Purchase[] =>
  M6.flatMap((m) => [
    ...Array.from({ length: 10 }, (_, k) => buy(`${m}-${String(3 + k).padStart(2, "0")}`, start + k * 100)),
    ...Array.from({ length: 30 }, (_, k) => buy(`${m}-${String(1 + (k % 28)).padStart(2, "0")}`, 9000)),
  ]);

test("4: compras de até R$ 30 somam o mês e a alavanca é metade", () => {
  const h = pick(run(smallCase(2000)), "compras_pequenas")!;
  assert.equal(h.base.corte_compras, 60);
  assert.deepEqual(h.metades, [24500, 24500]);
  assert.deepEqual(h.alavancas, [{ tipo: "compras_pequenas_pela_metade", cents: 12200n }]);
});

test("4: compras pequenas todas iguais também contam", () => {
  const p = M6.flatMap((m) => Array.from({ length: 20 }, (_, k) => buy(`${m}-${String(1 + k).padStart(2, "0")}`, 1500)));
  assert.equal(pick(run(p), "compras_pequenas")?.base.corte_compras, 120);
});

test("4: limite de R$ 100 por mês (R$ 99 não, R$ 100 sim)", () => {
  assert.equal(pick(run(smallCase(540)), "compras_pequenas"), undefined);
  assert.ok(pick(run(smallCase(550)), "compras_pequenas"));
});

// ---------- análise 5: recorrência escondida ----------

const everyDays = (start: string, gap: number, n: number): string[] =>
  Array.from({ length: n }, (_, k) => addDays(start, gap * k)).filter((d) => d <= "2026-06-30");

test("5: assinatura mensal fora das contas fixas e alavanca cancelar_recorrencia", () => {
  const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"];
  const h = pick(run(many(dates, 2190, { label: "Spotify" })), "recorrencia_escondida", "", "lugar")!;
  assert.equal(h.corte, "todo mês");
  assert.deepEqual(h.alavancas, [{ tipo: "cancelar_recorrencia", cents: 2100n }]);
  assert.deepEqual(h.metades, [3, 3]);
});

test("5: já cadastrada como conta fixa não é escondida", () => {
  const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"];
  const p = [...many(dates, 2190, { label: "Spotify" }), buy("2026-01-06", 2190, { label: "Spotify", type: "fixa" })];
  assert.equal(pick(run(p), "recorrencia_escondida", "", "lugar"), undefined);
});

test("5: intervalo de 25 dias passa, 24 não; 35 passa, 36 não", () => {
  const rec = (gap: number, start: string) => pick(run(many(everyDays(start, gap, 8), 3000, { label: "Plano" })), "recorrencia_escondida", "", "lugar");
  assert.ok(rec(25, "2026-01-01"));
  assert.equal(rec(24, "2026-01-01"), undefined);
  assert.ok(rec(35, "2026-01-01"));
  assert.equal(rec(36, "2026-01-01"), undefined);
});

test("5: recorrência semanal vale valor x 52/12 por mês; valor 20% fora do mediano quebra a regra", () => {
  const h = pick(run(many(everyDays("2026-01-05", 7, 26), 3000, { label: "Academia" })), "recorrencia_escondida", "", "lugar")!;
  assert.equal(h.corte, "toda semana");
  assert.equal(h.alavancas[0]!.cents, 13000n);
  const dates = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"];
  const mixed = dates.map((d, k) => buy(d, k % 2 ? 2600 : 2190, { label: "Spotify" }));
  assert.equal(pick(run(mixed), "recorrencia_escondida", "", "lugar"), undefined);
});

// ---------- análise 6: ritmo depois do salário ----------

const SALARY = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05", "2026-05-05", "2026-06-05"];
const rhythm = (windowPerCycle: number[]): Purchase[] =>
  SALARY.slice(0, 5).flatMap((s, c) => [
    ...Array.from({ length: windowPerCycle[c]! }, (_, k) => buy(addDays(s, k % 4), 10000)),
    ...Array.from({ length: 10 - windowPerCycle[c]! }, (_, k) => buy(addDays(s, 15 + (k % 6)), 10000)),
  ]);

test("6: 20 de 30 compras nos 7 dias depois do salário: índice 2,876 e excesso de R$ 217", () => {
  const p = SALARY.slice(0, 5).flatMap((s) => [
    ...[0, 1, 2, 3].map((k) => buy(addDays(s, k), 10000)),
    ...[15, 20].map((k) => buy(addDays(s, k), 10000)),
  ]);
  const r = run(p, { salaryDates: SALARY });
  const h = pick(r, "ritmo_salario")!;
  assert.equal(r.ciclo_salario, true);
  // Ciclos de 05/01 a 04/06 = 151 dias, 35 deles na janela de 7 dias.
  near(h.indice!, 20 / 30 / (35 / 151), 0.001);
  // (200000 - 300000 * 35/151) / 6 = 21743,9
  assert.equal(h.em_jogo_cents, 21700n);
  assert.deepEqual(h.alavancas, []);
});

test("6: limite de força 1,5 (17 de 50 não, 18 de 50 sim) e sem salário não roda", () => {
  assert.equal(pick(run(rhythm([4, 4, 3, 3, 3]), { salaryDates: SALARY }), "ritmo_salario"), undefined);
  assert.ok(pick(run(rhythm([4, 4, 4, 3, 3]), { salaryDates: SALARY }), "ritmo_salario"));
  const r = run(rhythm([4, 4, 4, 3, 3]));
  assert.equal(r.ciclo_salario, false);
  assert.equal(pick(r, "ritmo_salario"), undefined);
});

// ---------- análise 7: comprometimento ----------

const fixedCase = (cents: number): Purchase[] =>
  M6.map((m) => buy(`${m}-10`, cents, { label: "Aluguel", type: "fixa", category: "Moradia" }));

test("7: contas fixas e parcelas em 40% da renda passam; 39,9% não", () => {
  const ok = pick(run(fixedCase(120000), { incomeAvgCents: 300000n }), "comprometimento", "contas fixas")!;
  near(ok.indice!, 0.4, 0.0001);
  assert.equal(pick(run(fixedCase(119700), { incomeAvgCents: 300000n }), "comprometimento", "contas fixas"), undefined);
  assert.equal(pick(run(fixedCase(120000)), "comprometimento", "contas fixas"), undefined);
});

test("7: fixas e parcelas não entram nas análises de comportamento", () => {
  const r = run(fixedCase(120000), { incomeAvgCents: 300000n });
  assert.deepEqual(r.destaques.filter((h) => h.analise !== "comprometimento"), []);
});

const startsCase = (n: number): Purchase[] =>
  Array.from({ length: n }, (_, k) =>
    buy(`${M6[Math.floor(k / 2)]!}-${k % 2 ? "20" : "10"}`, 10000, { type: "parcela", installmentStart: true, label: `Parcela ${k}` }),
  );

test("7: 2 parcelamentos novos por mês passam; 11 em 6 meses não", () => {
  const h = pick(run(startsCase(12)), "comprometimento", "parcelamentos")!;
  assert.equal(h.indice, 2);
  assert.deepEqual(h.metades, [2, 2]);
  assert.equal(pick(run(startsCase(11)), "comprometimento", "parcelamentos"), undefined);
});

// ---------- análise 8: dias fora da curva ----------

const calm = ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05", "2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15"];
const peaks = (dates: string[]): Purchase[] => [...many(dates, 100000), ...many(calm, 1000)];

test("8: 5 picos, 3 deles no sábado (60%) passam com excesso calculado", () => {
  const h = pick(run(peaks(["2026-01-10", "2026-04-11", "2026-05-09", "2026-01-06", "2026-04-08"])), "dias_fora_da_curva", "sábado")!;
  assert.equal(h.indice, 0.6);
  assert.deepEqual(h.metades, [0.5, 2 / 3]);
});

test("8: 2 de 5 picos no sábado não passam", () => {
  assert.equal(pick(run(peaks(["2026-01-10", "2026-04-11", "2026-01-06", "2026-04-08", "2026-05-06"])), "dias_fora_da_curva"), undefined);
});

test("8: 5 sábados passam (excesso R$ 809); 4 picos não", () => {
  const five = pick(run(peaks(["2026-01-10", "2026-01-24", "2026-04-11", "2026-05-09", "2026-02-14"])), "dias_fora_da_curva", "sábado")!;
  // (500000 - 5 * 508000/181) / 6 = 80994,5
  assert.equal(five.em_jogo_cents, 80900n);
  assert.equal(pick(run(peaks(["2026-01-10", "2026-01-24", "2026-04-11", "2026-05-09"])), "dias_fora_da_curva"), undefined);
});

// ---------- análise 9: forma de pagamento ----------

const mix = (older: [number, number, number], recent: [number, number, number]): Purchase[] =>
  M6.flatMap((m, i) => {
    const [pix, deb, cred] = i < 3 ? older : recent;
    const pays = [...Array<"pix">(pix).fill("pix"), ...Array<"debito">(deb).fill("debito"), ...Array<"credito">(cred).fill("credito")];
    return pays.map((payment, k) => buy(`${m}-${String(1 + k).padStart(2, "0")}`, 10000, { payment }));
  });

test("9: Pix de 20% para 50% do avulso passa; de 20% para 30% não", () => {
  const h = pick(run(mix([4, 12, 4], [10, 7, 3])), "forma_pagamento", "pix")!;
  assert.match(h.corte, /subiu$/);
  assert.deepEqual(h.metades, [0.2, 0.5]);
  assert.equal(pick(run(mix([4, 12, 4], [8, 9, 3])), "forma_pagamento", "pix")!.metades![1], 0.4);
  assert.equal(pick(run(mix([4, 12, 4], [6, 11, 3])), "forma_pagamento", "pix"), undefined);
});

// ---------- ordenação, resultado e total de categoria ----------

test("destaques saem ordenados pelo dinheiro em jogo e respeitam o máximo", () => {
  const r = run([...many(mondays, 10000), ...lazer(2, [4, 4, 4], 5000)], { maxDestaques: 3 });
  assert.ok(r.destaques.length <= 3);
  const money = r.destaques.map((h) => h.em_jogo_cents);
  assert.deepEqual([...money].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)), money);
  assert.ok(r.sem_padrao.aprovadas >= r.destaques.length);
});

test("categoryTotalCents soma todos os tipos da categoria e ignora estorno", () => {
  const p = [
    buy("2026-01-05", 10000),
    buy("2026-02-05", 2500, { type: "fixa" }),
    buy("2026-03-05", 700, { type: "parcela" }),
    buy("2026-03-06", -900),
    buy("2026-03-07", 5000, { category: "Lazer" }),
  ];
  assert.equal(categoryTotalCents(p, "Mercado"), 13200n);
  assert.equal(categoryTotalCents(p, "Mercado", ["2026-01", "2026-02"]), 12500n);
});

// ---------- rastreio de diagnóstico (M1): só observa ----------

const withIds = (ps: Purchase[]): Purchase[] => ps.map((p, k) => ({ ...p, id: `t${k}` }));
const scenarios: Array<[string, Purchase[], Partial<Parameters<typeof findPatterns>[0]>]> = [
  ["fim de semana", weekendCase(9, 9), {}],
  ["tendência que sobe", lazer(2, [4, 4, 4], 5000), {}],
  ["tendência sem variação", lazer(3, [3, 3, 3], 5000), {}],
  ["lugares", placeCase([["A", 2, 2], ["B", 2, 2], ["C", 2, 2], ["D", 1, 1], ["E", 1, 1], ["F", 1, 1], ["G", 1, 1]]), {}],
  ["compras pequenas", smallCase(500), {}],
  ["ritmo do salário", rhythm([6, 6, 6, 6, 6]), { salaryDates: SALARY }],
  ["fixas e parcelas", [...fixedCase(120000), ...startsCase(12)], { incomeAvgCents: 300000n }],
  ["picos", peaks(["2026-01-03", "2026-01-10", "2026-02-07", "2026-04-04", "2026-05-02", "2026-06-09"]), {}],
  ["forma de pagamento", mix([10, 5, 5], [4, 5, 11]), {}],
];
const everything = withIds(scenarios.flatMap(([, ps]) => ps));
const fullExtra = { salaryDates: SALARY, incomeAvgCents: 300000n };
const traced = (ps: Purchase[], extra: Partial<Parameters<typeof findPatterns>[0]> = {}) => {
  const trace = new PatternTrace();
  return { result: run(ps, { ...extra, trace }), trace };
};

test("rastreio: com e sem trace o resultado é idêntico em cada cenário e na mistura de todos", () => {
  for (const [name, ps, extra] of [...scenarios, ["tudo junto", everything, fullExtra] as const]) {
    assert.deepEqual(traced(withIds(ps), extra).result, run(withIds(ps), extra), name);
  }
});

test("rastreio: cada destaque tem exatamente um candidato aprovado, com as compras do corte", () => {
  const { result, trace } = traced(everything, fullExtra);
  const approved = trace.candidates.filter((c) => c.status === "aprovado");
  assert.deepEqual(approved.map(findingKey).sort(), result.destaques.map(findingKey).sort());
  for (const h of result.destaques) {
    const c = approved.find((a) => findingKey(a) === findingKey(h))!;
    assert.equal(c.corte_ids!.length, h.base.corte_compras, findingKey(h));
    assert.equal(c.base.compras, h.base.recorte_compras, findingKey(h));
    assert.ok(c.corte_ids!.length <= c.base.ids!.length);
  }
});

test("rastreio: rejeição diz o motivo real; recorte abaixo do mínimo não lista ids", () => {
  const flat = traced(withIds(lazer(3, [3, 3, 3], 5000))).trace.candidates;
  const lazerTrend = flat.find((c) => c.analise === "tendencia" && c.recorte.tipo === "categoria" && c.recorte.chave === "Lazer")!;
  assert.equal(lazerTrend.motivo, "below_threshold");
  assert.ok(Array.isArray((lazerTrend.evidencia as { gasto_por_mes_cents: number[] }).gasto_por_mes_cents));
  const noSalary = traced(withIds(rhythm([6, 6, 6, 6, 6]))).trace.candidates.find((c) => c.analise === "ritmo_salario")!;
  assert.equal(noSalary.motivo, "no_salary_dates");
  const thin = traced(everything, fullExtra).trace.candidates.filter((c) => c.motivo === "insufficient_base");
  assert.ok(thin.length > 0);
  assert.ok(thin.every((c) => c.base.ids === null));
});

test("rastreio: concentração guarda a distribuição inteira do eixo, não só a fatia campeã", () => {
  const { trace } = traced(withIds(weekendCase(9, 9)));
  const c = trace.candidates.find((x) => x.analise === "concentracao_tempo" && x.recorte.tipo === "casa" && x.variante === "parte_do_mes")!;
  const dist = (c.evidencia as { distribuicao: { fatia: string }[] }).distribuicao.map((d) => d.fatia);
  assert.deepEqual(dist, ["início", "meio", "fim"]);
});

test("rastreio: seleção separa enviado, deduplicado e corte do limite; sobreposição mede Jaccard e cobertura", () => {
  const h = (tipo: Highlight["recorte"]["tipo"], corte: string, n: number): Highlight => ({
    analise: "tendencia", recorte: { tipo, chave: tipo }, corte, indice: null, metades: null, alavancas: [], em_jogo_cents: 100n, em_jogo_natureza: "alavanca",
    base: { corte_compras: n, corte_cents: BigInt(n * 100), recorte_compras: n, recorte_cents: BigInt(n * 100) },
  });
  const [a, b, bCasa, c] = [h("categoria", "alta", 5), h("lugar", "queda", 7), h("casa", "queda", 7), h("conta", "alta", 9)];
  const entries = selectionTrace([a, bCasa, b, c], [a, b, c], [a, b], ["p0", "p1"]);
  assert.deepEqual(entries.map((e) => [e.status, e.ref, e.absorvido_por]), [
    ["enviado", "p0", null],
    ["deduplicated", null, findingKey(b)],
    ["enviado", "p1", null],
    ["ranking_cutoff", null, null],
  ]);
  const { trace } = traced(everything, fullExtra);
  const pairs = overlaps(trace.candidates);
  assert.ok(pairs.length > 0);
  for (const p of pairs) {
    assert.ok(p.jaccard > 0 && p.jaccard <= p.cobertura && p.cobertura <= 1, `${p.a} x ${p.b}`);
  }
});

test("rastreio: sobreposição separa duplicado, mesmas compras, contido e parcial", () => {
  assert.equal(overlapRelation(0.9, 0.95, true), "duplicado");
  assert.equal(overlapRelation(0.9, 0.95, false), "mesmas_compras");
  assert.equal(overlapRelation(0.3, 1, true), "contido");
  assert.equal(overlapRelation(0.3, 0.5, false), "parcial");
  const { trace } = traced(everything, fullExtra);
  for (const p of overlaps(trace.candidates)) {
    assert.equal(p.relacao, overlapRelation(p.jaccard, p.cobertura, p.mesma_analise));
    assert.equal(p.especifico !== null, p.relacao === "contido");
  }
});
