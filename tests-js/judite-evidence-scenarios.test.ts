// Recuperação de memória e contrato de evidência além do caso Delivery.
// Provedor simulado: o que se afirma é o que o SERVIDOR busca e entrega.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDatabase, asUser, type Database } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { saveMemoryTx } from "../src/server/ai-assistant-memories.ts";
import { createGoal } from "../src/server/reserve-goal.ts";
import { askHelp } from "../src/server/help.ts";
import { recallIntent } from "../src/server/judite-evidence.ts";

let n = 0;
async function family(db: Database): Promise<Identity> {
  const email = `ev${n++}@example.invalid`;
  const userId = await createFamily(db, { name: "Pessoa", familyName: "Casa", email, password: "SenhaFicticia!2026" });
  const familyId = (await db.query<{ household_id: string }>("SELECT household_id FROM members WHERE user_id=$1", [userId])).rows[0].household_id;
  return { userId, familyId, name: "Pessoa", email, role: "owner" };
}

const base = {
  kind: "combinado" as const,
  context: "Conversa de teste.",
  topics: [] as string[],
  category: null as string | null,
  as_of: "2026-11-10",
  effective_from: null as string | null,
  effective_until: null as string | null,
  replaces: null as string | null,
};
const save = (db: Database, u: Identity, over: Record<string, unknown>) =>
  asUser(db, u.userId, (tx) => saveMemoryTx(tx, u, { ...base, text: "x", ...over })) as Promise<{ id: string }>;

async function ensureCategory(db: Database, u: Identity, name: string) {
  const found = await db.query("SELECT id FROM categories WHERE household_id=$1 AND name=$2", [u.familyId, name]);
  if (!found.rows.length) await db.query("INSERT INTO categories(id,household_id,name) VALUES(gen_random_uuid(),$1,$2)", [u.familyId, name]);
}

function fakeProvider(replies: unknown[]) {
  const seen: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages: { role: string; content: string }[] };
    seen.push(JSON.parse(body.messages.find((m) => m.role === "user")!.content));
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)];
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }] });
  }) as typeof fetch;
  return seen;
}
async function withProvider(run: () => Promise<void>) {
  const original = globalThis.fetch;
  const keys = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { AI_PROVIDER: "groq", GROQ_API_KEY: "synthetic-key", GROQ_ZDR_CONFIRMED: "true" });
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}
const month = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
const ask = (question: string) => ({ question, month, currency: "BRL", external: true, chat: true, history: [] });

type Mem = { ref: string; tipo: string; significa: string; texto: string; vigencia?: string };
type Called = { chamada: { name: string; comparar_com?: string; categoria?: string }; resultado: { memorias?: Mem[]; busca?: string } };

/** Pergunta com o provedor simulado e devolve o que o servidor entregou ao modelo. */
async function delivered(db: Database, u: Identity, question: string) {
  let seen: Record<string, unknown>[] = [];
  await withProvider(async () => {
    seen = fakeProvider([{ text: "Certo.", action: null }]);
    await askHelp(db, u, ask(question));
  });
  const tools = ((seen[0].tool_results as Called[] | undefined) ?? []);
  const memories = tools.filter((t) => t.chamada.name === "search_memory").flatMap((t) => t.resultado.memorias ?? []);
  return { seen, tools, memories, names: tools.map((t) => t.chamada.name) };
}

test("1. combinado sem categoria: o prefetch acha; 'cumprindo' não inventa histórico", async () => {
  const db = await openDatabase();
  const u = await family(db);
  await save(db, u, { text: "Combinamos não pedir comida depois das 22h.", topics: ["comida", "delivery"] });
  const found = await delivered(db, u, "o que a gente combinou sobre comer tarde?");
  assert.deepEqual(found.names, ["search_memory"]);
  assert.match(found.memories[0].texto, /22h/);
  assert.match(found.memories[0].significa, /não é teto de orçamento/);
  const check = await delivered(db, u, "estamos cumprindo o combinado da comida?");
  assert.deepEqual(check.names, ["search_memory"], "sem valor nem categoria no combinado, não há o que comparar");
  assert.equal(check.memories.length, 1);
});

test("2. objetivo de sobra sem reserva: acha a memória e diz que não é reserva", async () => {
  const db = await openDatabase();
  const u = await family(db);
  await save(db, u, { kind: "objetivo", text: "Sobrar 10% por mês.", topics: ["sobra", "meta"] });
  const r = await delivered(db, u, "qual era nossa meta de sobra?");
  assert.equal(r.memories[0]?.tipo, "objetivo");
  assert.match(r.memories[0].significa, /não é reserva cadastrada/);
  assert.ok(!r.names.includes("reservas"));
});

test("3. reserva 'Viagem' e memória do objetivo chegam como fontes distintas", async () => {
  const db = await openDatabase();
  const u = await family(db);
  await createGoal(db, u, { name: "Viagem", target: "5000,00", deadline_month: null });
  await save(db, u, { kind: "objetivo", text: "Guardar R$ 300,00 por mês para a viagem.", topics: ["viagem"] });
  const r = await delivered(db, u, "qual era o objetivo da viagem?");
  assert.match(r.memories[0].texto, /viagem/);
  assert.match(r.memories[0].significa, /não é reserva cadastrada/);
  assert.match(JSON.stringify(r.seen[0].retrieval), /Viagem/, "a reserva cadastrada vem nos fatos, separada da memória");
});

test("4. compromisso futuro chega com vigencia futura", async () => {
  const db = await openDatabase();
  const u = await family(db);
  const next = new Date();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + 1);
  await save(db, u, { text: "Combinamos viajar em dezembro sem estourar o cartão.", topics: ["dezembro"], effective_from: next.toISOString().slice(0, 10) });
  const r = await delivered(db, u, "o que combinamos para dezembro?");
  assert.equal(r.memories[0]?.vigencia, "futura");
});

test("5. decisão substituída: só a vigente é buscada e comparada", async () => {
  const db = await openDatabase();
  const u = await family(db);
  await ensureCategory(db, u, "Lazer");
  const old = await save(db, u, { text: "Lazer até R$ 1.000,00 por mês.", topics: ["lazer"], category: "Lazer" });
  await save(db, u, { text: "Lazer até R$ 900,00 por mês.", topics: ["lazer"], category: "Lazer", replaces: old.id });
  const r = await delivered(db, u, "estamos cumprindo o limite de lazer que combinamos?");
  assert.deepEqual(r.memories.map((m) => m.texto), ["Lazer até R$ 900,00 por mês."]);
  const compared = r.tools.find((t) => t.chamada.name === "historico_categoria");
  assert.equal(compared?.chamada.comparar_com, r.memories[0].ref);
});

test("6. perguntas sem pedido inequívoco não disparam o prefetch; o modelo decide pelo resumo", async () => {
  const db = await openDatabase();
  const u = await family(db);
  await save(db, u, { text: "Delivery até R$ 600,00.", topics: ["delivery"] });
  const vague = ["e aquela história do delivery?", "lembra do limite de lazer?", "como ficou a meta?"];
  for (const q of vague) {
    assert.equal(recallIntent(q), false, q);
    const r = await delivered(db, u, q);
    assert.deepEqual(r.names, [], q);
    assert.deepEqual(r.seen[0].memoria_do_assistente, { por_tipo: { combinado: 1 }, temas: ["delivery"] }, "o modelo vê que há memória e os temas");
  }
});
