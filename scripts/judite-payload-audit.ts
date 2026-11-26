// Auditoria de privacidade do que a Judite envia ao provedor de IA. Roda sobre
// uma família FICTÍCIA em memória, com provedor simulado (sem rede), captura o
// corpo de cada requisição e mede por caminho: tipo do campo e detecções de dado
// pessoal. Nunca imprime nem grava valor: só caminhos, rótulos e contagens.
//
// Uso: node --disable-warning=ExperimentalWarning --experimental-strip-types scripts/judite-payload-audit.ts
// Sai com código 1 se sobrar CPF, CNPJ, cartão, telefone, email ou nome após Pix.
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asUser, openDatabase, type Database } from "../src/server/db.ts";
import { createFamily, type Identity } from "../src/server/auth.ts";
import { askHelp } from "../src/server/help.ts";
import { saveNote } from "../src/server/context-notes.ts";
import { saveMemoryTx } from "../src/server/ai-assistant-memories.ts";
import { createGoal } from "../src/server/reserve-goal.ts";
import { saveItem } from "../src/server/routine.ts";
import { auditPayload, type Detector } from "../src/domain/prompt-privacy.ts";

/** Valores fictícios que o harness planta; o relatório só mostra o rótulo. */
export const SENSITIVE = {
  nome_pix_caixa_alta: "MARIA APARECIDA SOUZA",
  nome_pix_capitalizado: "João Carlos Pereira",
  nome_pix_minusculo: "carlos eduardo lima",
  nome_solto: "Marlene Ribeiro Duarte",
  cpf_formatado: "529.982.247-25",
  cpf_cru: "52998224725",
  cnpj_formatado: "11.222.333/0001-81",
  cnpj_cru: "11222333000181",
  telefone: "(11) 98765-4321",
  email: "marlene.duarte@example.invalid",
  chave_pix_aleatoria: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
} as const;
export type Label = keyof typeof SENSITIVE;

/** Limitações conhecidas: nome sem pista estrutural não é detectável com segurança. */
export const KNOWN_LIMITATIONS: readonly Label[] = ["nome_solto", "nome_pix_minusculo"];

const BLOCKING: readonly Detector[] = ["cpf", "cnpj", "cartao", "telefone", "email", "nome_apos_transferencia"];

const S = SENSITIVE;
const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
const month = today.slice(0, 7);

function shift(back: number, d: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 - back, d)).toISOString().slice(0, 10);
}

async function buildFamily(db: Database): Promise<Identity> {
  const email = "auditoria@example.invalid";
  const userId = await createFamily(db, { name: "Pessoa fictícia", familyName: "Auditoria", email, password: "SenhaFicticia!2026" });
  const familyId = (await db.query<{ household_id: string }>("SELECT household_id FROM members WHERE user_id=$1", [userId])).rows[0]
    .household_id;
  const user: Identity = { userId, familyId, name: "Pessoa", email, role: "owner" };
  let mercadoId = "";
  await asUser(db, userId, async (tx) => {
    const bank = randomUUID();
    await tx.query(
      "INSERT INTO accounts(id,household_id,name,institution,currency,kind,opening_cents,opening_date,created_by) VALUES($1,$2,'Corrente','Banco Fictício','BRL','checking',0,'2020-01-01',$3)",
      [bank, familyId, userId],
    );
    const category = async (name: string): Promise<string> => {
      const found = await tx.query<{ id: string }>("SELECT id FROM categories WHERE household_id=$1 AND name=$2", [familyId, name]);
      if (found.rows[0]) return found.rows[0].id;
      const id = randomUUID();
      await tx.query("INSERT INTO categories(id,household_id,name) VALUES($1,$2,$3)", [id, familyId, name]);
      return id;
    };
    const mercado = await category("Mercado");
    const presentes = await category("Presentes");
    mercadoId = mercado;
    const tag = randomUUID();
    await tx.query("INSERT INTO category_tags(id,household_id,category_id,name) VALUES($1,$2,$3,$4)", [
      tag,
      familyId,
      presentes,
      `Aniversário de ${S.nome_solto}`,
    ]);
    const add = async (
      kind: "income" | "expense",
      date: string,
      reais: number,
      categoryId: string | null,
      desc: string,
      tagId: string | null = null,
    ): Promise<void> => {
      const id = randomUUID();
      const signed = (kind === "income" ? 1 : -1) * reais * 100;
      await tx.query(
        `INSERT INTO economic_events(id,household_id,account_id,kind,transaction_date,description,original_description,amount_cents,currency,category_id,tag_id,created_by)
         VALUES($1,$2,$3,$4,$5,$9,$9,$6,'BRL',$7,$10,$8)`,
        [id, familyId, bank, kind, date, signed, categoryId, userId, desc, tagId],
      );
      await tx.query(
        `INSERT INTO ledger_entries(id,household_id,event_id,account_id,nominal,currency,amount_cents,transaction_date)
         VALUES($1,$2,$3,$4,NULL,'BRL',$6,$8),($5,$2,$3,NULL,$9,'BRL',$7,$8)`,
        [randomUUID(), familyId, id, bank, randomUUID(), signed, -signed, date, kind],
      );
    };
    for (const back of [4, 3, 2, 1, 0]) {
      const d = (n: number) => shift(back, n);
      await add("income", d(5), 9000, null, `Salário ${S.cnpj_formatado} ${S.cnpj_cru}`);
      await add("income", d(6), 300, null, `PIX RECEBIDO ${S.nome_pix_caixa_alta} ${S.cpf_formatado}`);
      await add("income", d(7), 150, null, `Pix recebido de ${S.nome_pix_capitalizado} CPF ${S.cpf_cru}`);
      await add("expense", d(8), 2200, mercado, `Supermercado ${S.telefone} ${S.email}`);
      await add("expense", d(9), 400, presentes, `PIX ENVIADO ${S.nome_pix_caixa_alta}`, tag);
      await add("expense", d(10), 250, presentes, `pix enviado ${S.nome_pix_minusculo}`, tag);
      await add("expense", d(11), 180, mercado, `Transferência para ${S.nome_pix_capitalizado} chave ${S.chave_pix_aleatoria}`);
      await add("expense", d(12), 90, mercado, `Presente para ${S.nome_solto}`);
    }
  });
  await saveNote(db, user, { scope: "household", note: `Ajudamos ${S.nome_solto}, contato ${S.email}, CPF ${S.cpf_formatado}.` });
  await saveNote(db, user, { scope: "category", category: "Presentes", note: `Presentes da ${S.nome_solto}.` });
  const memory = (text: string) =>
    asUser(db, userId, (tx) =>
      saveMemoryTx(tx, user, {
        kind: "combinado",
        text,
        context: `Conversa sobre ${S.nome_solto}.`,
        topics: ["presentes"],
        category: null,
        as_of: shift(1, 28),
        effective_from: null,
        effective_until: null,
        replaces: null,
      }),
    );
  await memory(`Combinamos limitar presentes para ${S.nome_solto} a R$ 200,00 por mês.`);
  await createGoal(db, user, { name: `Viagem da ${S.nome_solto}`, target: "5000,00", deadline_month: null });
  await saveItem(db, user, {
    month,
    label: `Mesada ${S.nome_solto}`,
    purpose: "expense",
    currency: "BRL",
    cost_type: "fixed",
    amount: "300,00",
    due_date: shift(0, 20),
    category_id: mercadoId,
    notes: `Pagar por Pix para ${S.nome_solto} telefone ${S.telefone}`,
  });
  return user;
}

type Tool = Record<string, unknown> & { name: string };
const prev = (n: number) => shift(n, 1).slice(0, 7);
const QUESTIONS: { question: string; tools: Tool[] }[] = [
  {
    question: "Onde dá para cortar para sobrar mais?",
    tools: [
      { name: "sobra_atual" },
      { name: "acima_do_normal" },
      { name: "historico_categoria", categoria: "c0" },
      { name: "detalhar_categoria", categoria: "c0", de: shift(3, 1), ate: today },
      { name: "buscar_movimentos", texto: "pix", de: shift(3, 1), ate: today, limite: 100 },
      { name: "maiores_gastos", de: shift(3, 1), ate: today, n: 20 },
    ],
  },
  {
    question: "O que mudou e o que falta pagar?",
    tools: [
      { name: "comparar_meses", mes_a: prev(2), mes_b: prev(1) },
      { name: "mes_atual" },
      { name: "contas_fixas" },
      { name: "cartoes" },
      { name: "reservas" },
      { name: "search_memory", consulta: "o que combinamos sobre presentes" },
    ],
  },
  {
    question: "Quais lançamentos temos com Pix e o que a casa contou?",
    tools: [
      { name: "notas" },
      { name: "buscar_movimentos", de: shift(1, 1), ate: today, limite: 100 },
      { name: "maiores_gastos", de: shift(3, 1), ate: today, n: 20, agrupar: "nome" },
      { name: "detalhar_categoria", categoria: "c1", de: shift(3, 1), ate: today },
      { name: "search_memory", temas: ["presentes"] },
      { name: "historico_categoria", categoria: "c1" },
    ],
  },
];

const HISTORY = [
  { role: "user" as const, text: `Mandei Pix para ${S.nome_pix_caixa_alta}, CPF ${S.cpf_formatado}, chave ${S.chave_pix_aleatoria}.` },
  { role: "assistant" as const, text: `Anotado o Pix para ${S.nome_pix_capitalizado}, chave ${S.email}.` },
  { role: "user" as const, text: `Fiz um pix enviado ${S.nome_pix_minusculo} ontem.` },
  { role: "user" as const, text: `Também ajudei ${S.nome_solto}, telefone ${S.telefone}.` },
];

type Part = { text: string };
type Message = { role: string; content: string | Part[] };

function userPayload(body: { messages?: Message[] }): unknown {
  const merged: Record<string, unknown> = {};
  for (const m of body.messages ?? []) {
    if (m.role !== "user") continue;
    const parts = typeof m.content === "string" ? [m.content] : m.content.map((p) => p.text);
    for (const part of parts) Object.assign(merged, JSON.parse(part) as Record<string, unknown>);
  }
  return merged;
}

async function captureBodies(db: Database, user: Identity): Promise<unknown[]> {
  const bodies: unknown[] = [];
  const keys = ["AI_PROVIDER", "GROQ_API_KEY", "GROQ_ZDR_CONFIRMED"];
  const env = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const fetchOriginal = globalThis.fetch;
  process.env.AI_PROVIDER = "groq";
  process.env.GROQ_API_KEY = "synthetic-key";
  process.env.GROQ_ZDR_CONFIRMED = "true";
  try {
    for (const { question, tools } of QUESTIONS) {
      let calls = 0;
      globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? "{}") as { messages?: Message[] };
        bodies.push(userPayload(body));
        const tool = tools[calls++];
        const reply = tool ? { tool } : { text: "Pronto.", action: null };
        return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...reply }) } }] });
      }) as typeof fetch;
      await askHelp(db, user, { question, month, currency: "BRL", external: true, chat: true, history: HISTORY });
    }
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
  return bodies;
}

const generic = (path: string) => path.replace(/\[\d+\]/g, "[]");

function leaves(value: unknown, path = "$", out: { path: string; text: string }[] = []) {
  if (typeof value === "string") out.push({ path: generic(path), text: value });
  else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) leaves(v, `${path}.${k}`, out);
  return out;
}

/** Texto livre que sai e o que a análise precisa dele. Regras por caminho; o resto cai em "não classificado". */
const PURPOSE: [RegExp, "necessário" | "desnecessário", string][] = [
  [/memorias\[\]\.contexto$/, "desnecessário", "origem da conversa que gerou a memória; a análise usa texto, tipo e data"],
  [/\.history\[\]\.text$/, "necessário", "continuidade da conversa; reduzir turnos antigos e as respostas do assistente"],
  [/linhas\[\]\.nome$|nomes\[\]\.nome$/, "necessário", "julgar o que é essencial pelo nome do gasto; descrição livre da casa"],
  [/linhas\[\]\.etiqueta$|linhas\[\]\.conta$|accounts\[\]\.name$/, "necessário", "nome dado pela casa a etiqueta ou conta; referência da análise"],
  [/goals\[\]\.name$|items\[\]\.label$|objetivos\[\]\.nome$/, "necessário", "nome dado pela casa a objetivo ou item de plano; referência das ações"],
  [/resultado\.casa$|categorias\[\]\.note$/, "necessário", "notas que a casa escreveu para a Judite"],
  [/memorias\[\]\.texto$/, "necessário", "conclusão ou combinado confirmado antes"],
  [/\.question$/, "necessário", "pergunta da pessoa"],
  [/./, "necessário", "vocabulário fixo ou nome de categoria/etiqueta/tema usado na análise"],
];

export type Report = {
  bodies: number;
  campos: { caminho: string; tipo: string; ocorrencias: number }[];
  deteccoes: { caminho: string; detector: Detector; contagem: number }[];
  textoLivre: { caminho: string; finalidade: string; motivo: string; ocorrencias: number }[];
  presentes: { rotulo: Label; caminhos: string[] }[];
  bloqueantes: { caminho: string; detector: Detector; contagem: number }[];
};

export async function runAudit(): Promise<Report> {
  const db = await openDatabase();
  const user = await buildFamily(db);
  const bodies = await captureBodies(db, user);

  const campos = new Map<string, { tipo: string; n: number }>();
  const deteccoes = new Map<string, number>();
  const presentes = new Map<Label, Set<string>>();
  for (const body of bodies) {
    const audit = auditPayload(body);
    for (const c of audit.campos) {
      const key = `${generic(c.caminho)}\u0000${c.tipo}`;
      campos.set(key, { tipo: c.tipo, n: (campos.get(key)?.n ?? 0) + 1 });
    }
    for (const d of audit.deteccoes) {
      const key = `${generic(d.caminho)}\u0000${d.detector}`;
      deteccoes.set(key, (deteccoes.get(key) ?? 0) + d.contagem);
    }
    for (const leaf of leaves(body)) {
      const lower = leaf.text.toLowerCase();
      for (const [label, value] of Object.entries(SENSITIVE) as [Label, string][])
        if (lower.includes(value.toLowerCase())) presentes.set(label, (presentes.get(label) ?? new Set()).add(leaf.path));
    }
  }
  const campoRows = [...campos].map(([key, v]) => ({ caminho: key.split("\u0000")[0], tipo: v.tipo, ocorrencias: v.n }));
  const deteccaoRows = [...deteccoes].map(([key, contagem]) => {
    const [caminho, detector] = key.split("\u0000");
    return { caminho, detector: detector as Detector, contagem };
  });
  const sort = <T extends { caminho: string }>(rows: T[]) => rows.sort((a, b) => a.caminho.localeCompare(b.caminho));
  return {
    bodies: bodies.length,
    campos: sort(campoRows),
    deteccoes: sort(deteccaoRows),
    textoLivre: sort(
      campoRows
        .filter((c) => c.tipo === "texto_livre")
        .map((c) => {
          const rule = PURPOSE.find(([re]) => re.test(c.caminho));
          return { caminho: c.caminho, finalidade: rule?.[1] ?? "não classificado", motivo: rule?.[2] ?? "", ocorrencias: c.ocorrencias };
        }),
    ),
    presentes: [...presentes].map(([rotulo, set]) => ({ rotulo, caminhos: [...set].sort() })),
    bloqueantes: deteccaoRows.filter((d) => BLOCKING.includes(d.detector)),
  };
}

/** Texto do relatório: caminhos, tipos, rótulos e contagens; nunca um valor. */
export function renderReport(r: Report): string {
  const lines = [`Requisições capturadas: ${r.bodies}`, "", "== Campos por caminho (tipo) =="];
  for (const c of r.campos) lines.push(`${c.caminho}  ${c.tipo}  x${c.ocorrencias}`);
  lines.push("", "== Detecções após a sanitização (caminho, detector, contagem) ==");
  if (!r.deteccoes.length) lines.push("nenhuma");
  for (const d of r.deteccoes) lines.push(`${d.caminho}  ${d.detector}  ${d.contagem}`);
  lines.push("", "== Texto livre por finalidade ==");
  for (const t of r.textoLivre) lines.push(`${t.caminho}  [${t.finalidade}]  ${t.motivo}`);
  lines.push("", "== Valores sensíveis do fixture ainda presentes (rótulo: caminhos) ==");
  if (!r.presentes.length) lines.push("nenhum");
  for (const p of r.presentes)
    lines.push(`${p.rotulo}${KNOWN_LIMITATIONS.includes(p.rotulo) ? " (limitação conhecida)" : ""}: ${p.caminhos.join(", ")}`);
  lines.push("", r.bloqueantes.length ? `FALHA: ${r.bloqueantes.length} detecção(ões) bloqueante(s).` : "OK: nenhuma detecção bloqueante.");
  return lines.join("\n");
}

const entry = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (entry === realpathSync(fileURLToPath(import.meta.url))) {
  const report = await runAudit();
  process.stdout.write(renderReport(report) + "\n");
  process.exit(report.bloqueantes.length ? 1 : 0);
}
