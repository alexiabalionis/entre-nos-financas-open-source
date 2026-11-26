// Fase 5 da SPEC-JUDITE-LACUNAS: cada família G em PGlite em memória, com as ferramentas chamadas direto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase } from "../src/server/db.ts";
import { initialPrefetch } from "../src/server/judite-evidence.ts";
import { runTool, type ToolContext } from "../src/server/judite-tools.ts";
import { toolCall } from "../src/server/judite-tools-schema.ts";
import { OPEN_QUESTION, catalogFor } from "../scripts/judite-eval-copiloto.ts";
import { ALL_SCENARIOS, ASKS_BEFORE_SUGGESTING, G3, G6, LACUNAS_SCENARIOS } from "../scripts/judite-eval-lacunas.ts";

type Income = { sobra_estrutural_cents: string; sobra_atual_media_cents: string; suspeitas: unknown[] };
type Warnings = {
  sem_categoria: { compras: number; total_cents: string; grupos: unknown[] };
  fora_da_curva: { categoria: string; mes_sem_ela_cents: string }[];
};
type Sequence = { sequencia: { gatilho: { compras: number }; indice: number } };

const db = await openDatabase();
async function ctxOf(id: string): Promise<ToolContext> {
  const user = await LACUNAS_SCENARIOS.find((s) => s.id === id)!.build(db, 0);
  return { db, user, catalog: await catalogFor(db, user), currency: "BRL", cache: {} };
}
const run = async <T>(ctx: ToolContext, call: Record<string, unknown>) => (await runTool(ctx, toolCall.parse({ tool: call }).tool)) as T;

test("as seis famílias G estão registradas e selecionáveis por --families", () => {
  assert.deepEqual(LACUNAS_SCENARIOS.map((s) => s.id), ["G1", "G2", "G3", "G4", "G5", "G6"]);
  const ids = new Set(ALL_SCENARIOS.map((s) => s.id));
  for (const id of ["A", "F01", "G1", "G2", "G3", "G4", "G5", "G6"]) assert.ok(ids.has(id), id);
  assert.equal(ids.size, ALL_SCENARIOS.length);
});

test("G1: sobra estrutural negativa com a sobra atual positiva", async () => {
  const out = await run<Income>(await ctxOf("G1"), { name: "renda_por_tipo" });
  assert.equal(out.sobra_estrutural_cents, "-100000");
  assert.ok(BigInt(out.sobra_atual_media_cents) > 0n);
});

test("G2: resgate e Pix do próprio membro viram 2 suspeitas, sem nome de pessoa", async () => {
  const out = await run<Income>(await ctxOf("G2"), { name: "renda_por_tipo" });
  assert.equal(out.suspeitas.length, 2);
  assert.doesNotMatch(JSON.stringify(out), /pessoa fict|pix recebido/i);
});

test("G3: 30 Pix sem categoria viram 3 grupos, sem nome de destinatário", async () => {
  const out = await run<Warnings>(await ctxOf("G3"), { name: "avisos_de_dados" });
  assert.equal(out.sem_categoria.compras, 30);
  assert.equal(out.sem_categoria.total_cents, String(G3.total * 100));
  assert.equal(out.sem_categoria.grupos.length, 3);
  assert.doesNotMatch(JSON.stringify(out), /carlos|alvarenga|denise|motta|eduardo|prado|123\.456/i);
});

test("G4: a câmera é o único fora_da_curva de Outras", async () => {
  const out = await run<Warnings>(await ctxOf("G4"), { name: "avisos_de_dados" });
  assert.equal(out.fora_da_curva.length, 1);
  assert.equal(out.fora_da_curva[0]!.categoria, "Outras");
  assert.equal(out.fora_da_curva[0]!.mes_sem_ela_cents, "20000");
});

test("G5: delivery depois do mercado grande tem índice acima de 1,5", async () => {
  const ctx = await ctxOf("G5");
  const cat = (name: string) => `c${ctx.catalog.categories.findIndex((c) => c.name === name)}`;
  const out = await run<Sequence>(ctx, {
    name: "investigar_gastos",
    operacoes: ["sequencia"],
    categoria: cat("Mercado"),
    depois_categoria: cat("Delivery"),
    valor_minimo_cents: "40000",
  });
  assert.equal(out.sequencia.gatilho.compras, 24);
  assert.ok(out.sequencia.indice > 1.5, `indice ${out.sequencia.indice}`);
});

test("G6: o aprendizado de perfil entra no prefetch e a busca devolve o TDAH", async () => {
  const ctx = await ctxOf("G6");
  const prefetch = initialPrefetch({ question: OPEN_QUESTION, activeMemories: 1, diagnostic: true });
  const profile = prefetch.find((c) => c.name === "search_memory");
  assert.equal(profile?.tipo, "aprendizado");
  const out = (await runTool(ctx, profile!)) as { memorias: { texto: string }[] };
  assert.ok(out.memorias.some((m) => m.texto === G6.memory));
});

test("regex das perguntas: pergunta antes de sugerir, negações não pegam", () => {
  assert.ok(ASKS_BEFORE_SUGGESTING.test("Onde vocês estão: antes de sugerir, quem é o destinatário? A próxima decisão: x."));
  assert.ok(!ASKS_BEFORE_SUGGESTING.test("A próxima decisão: cortar. Quem é o destinatário?"));
  const g6 = LACUNAS_SCENARIOS.find((s) => s.id === "G6")!.questions[0]!;
  const hits = (t: string) => g6.mustNot.some((p) => (p instanceof RegExp ? p.test(t) : t.includes(p)));
  assert.ok(hits("Vale anotar cada compra todo dia."));
  assert.ok(!hits("Sem precisar anotar todo dia, reserve um valor fixo."));
  assert.ok(hits("Dá para cortar a faxina."));
  assert.ok(!hits("Não se deve cortar a faxina nem a terapia."));
});
