"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "./button";
import { takeJuditeQuestion } from "./chat/handoff.ts";
import {
  JuditeAvatar,
  JuditeInProgress,
  JuditeWaiting,
} from "./chat/judite-waiting.tsx";
import { Panel } from "./ds/panel.tsx";
import { Icon } from "./ds/icon.tsx";
import { cx } from "./ds/shared.ts";
import type { Currency } from "../src/domain/finance.ts";

import type {
  ChatMessage as Message,
  Conversation,
} from "../src/server/chat-history.ts";
type Snapshot = {
  conversation: Conversation;
  messages: Message[];
  hasOlder: boolean;
  before: number | null;
};
async function post<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch("/api/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const value = await r.json();
  if (!r.ok)
    throw new Error(
      value.error || "Não foi possível concluir. Tente novamente.",
    );
  return value;
}
// Render plain React nodes only: no raw HTML or provider-controlled links.
function MessageText({ text }: { text: string }) {
  return (
    <div className="chat-text">
      {text.split("\n").map((line, n) => (
        <p key={n}>
          {line
            .split(/(\*\*[^*]+\*\*)/g)
            .map((part, i) =>
              part.startsWith("**") && part.endsWith("**") ? (
                <strong key={i}>{part.slice(2, -2)}</strong>
              ) : (
                part
              ),
            ) || "\u00a0"}
        </p>
      ))}
    </div>
  );
}
export function HelpPanel({
  month,
  currency,
  hidden,
  record,
  refresh,
  reader,
  active,
}: {
  month: string;
  currency: Currency;
  hidden: boolean;
  record: () => void;
  refresh: () => Promise<void>;
  reader: boolean;
  active: boolean;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [before, setBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("IA");
  const [ready, setReady] = useState(false);
  const [external, setExternal] = useState(false);
  const [settings, setSettings] = useState(false);
  const request = useRef<AbortController | null>(null);
  const loadingRequest = useRef<AbortController | null>(null);
  const initialized = useRef(false);
  const sending = useRef(false);
  const resolving = useRef(false);
  const context = useRef(month + currency);
  const selected = useRef<string | null>(null);
  const selectSequence = useRef(0);
  const dataRevision = useRef(0);
  const retry = useRef<{
    id: string;
    question: string;
    external: boolean;
  } | null>(null);
  const stickToBottom = useRef(true);
  const preserveScroll = useRef<{ height: number; top: number } | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const pending = messages.some((m) => m.pending);
  const referenceOnly = !!conversation && conversation.currency !== currency;
  async function list(append = false) {
    const r = await fetch(
      "/api/help/conversations?offset=" + (append ? conversations.length : 0),
      { cache: "no-store" },
    );
    const data = await r.json();
    if (!r.ok)
      throw new Error(
        data.error || "Não foi possível carregar suas conversas.",
      );
    setConversations((old) =>
      append
        ? [
            ...old,
            ...data.conversations.filter(
              (c: Conversation) => !old.some((o) => o.id === c.id),
            ),
          ]
        : data.conversations,
    );
    setHasMore(data.hasMore);
    return data.conversations as Conversation[];
  }
  function applySnapshot(data: Snapshot, merge = false) {
    setConversation(data.conversation);
    setMessages((old) =>
      merge
        ? [
            ...old.filter((m) => !data.messages.some((n) => n.id === m.id)),
            ...data.messages,
          ]
        : data.messages,
    );
    setHasOlder(data.hasOlder);
    setBefore(data.before);
  }
  async function choose(id: string) {
    if (sending.current || resolving.current) return;
    const sequence = ++selectSequence.current;
    loadingRequest.current?.abort();
    const c = new AbortController();
    loadingRequest.current = c;
    setLoading(true);
    setError("");
    try {
      const data = await post<Snapshot>(
        "help/conversations/open",
        { id },
        c.signal,
      );
      if (c.signal.aborted || sequence !== selectSequence.current) return;
      selected.current = id;
      context.current = data.conversation.month + currency;
      stickToBottom.current = true;
      retry.current = null;
      applySnapshot(data);
      setDraft("");
      setHistoryOpen(false);
    } catch (e) {
      if (!c.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Não foi possível abrir a conversa.",
        );
    } finally {
      if (sequence === selectSequence.current) setLoading(false);
    }
  }
  // Pergunta pronta vinda de outra tela (ex.: "Conversar com a Judite" no Simular).
  // Só depois de abrir a conversa: abrir limpa o rascunho.
  useEffect(() => {
    if (!active || loading) return;
    const q = takeJuditeQuestion();
    if (q) setDraft(q);
  }, [active, loading]);
  useEffect(() => {
    const c = new AbortController();
    void fetch("/api/help/status", { cache: "no-store", signal: c.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s) {
          setReady(s.externalReady);
          setProvider(s.provider);
        }
      })
      .catch(() => {});
    return () => {
      c.abort();
      request.current?.abort();
      loadingRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!active || initialized.current) return;
    initialized.current = true;
    void list()
      .then(async (rows) => {
        if (rows[0]) await choose(rows[0].id);
        else setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
        initialized.current = false;
      });
  }, [active]);
  useEffect(() => {
    if (context.current === month + currency) return;
    context.current = month + currency;
    selectSequence.current++;
    loadingRequest.current?.abort();
    request.current?.abort();
    selected.current = null;
    setConversation(null);
    setMessages([]);
    setHasOlder(false);
    setBefore(null);
    setDraft("");
    setError("");
    setBusy(false);
    setLoading(false);
    sending.current = false;
    retry.current = null;
  }, [month, currency]);
  useEffect(() => {
    if (hidden) {
      request.current?.abort();
      setBusy(false);
      sending.current = false;
      setHistoryOpen(false);
    }
  }, [hidden]);
  useEffect(() => {
    const syncViewport = () => {
      const v = window.visualViewport;
      if (v && v.scale !== 1) return;
      const height = v?.height ?? window.innerHeight;
      document.documentElement.style.setProperty(
        "--chat-viewport-height",
        height + "px",
      );
      document.documentElement.dataset.chatKeyboard =
        window.innerHeight - height > 140 ? "open" : "closed";
    };
    syncViewport();
    window.visualViewport?.addEventListener("resize", syncViewport);
    window.addEventListener("resize", syncViewport);
    return () => {
      window.visualViewport?.removeEventListener("resize", syncViewport);
      window.removeEventListener("resize", syncViewport);
      document.documentElement.style.removeProperty("--chat-viewport-height");
      delete document.documentElement.dataset.chatKeyboard;
    };
  }, []);
  useEffect(() => {
    if (!active || !log.current) return;
    if (preserveScroll.current) {
      log.current.scrollTop =
        log.current.scrollHeight -
        preserveScroll.current.height +
        preserveScroll.current.top;
      preserveScroll.current = null;
    } else if (stickToBottom.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [messages, busy, active, hidden]);
  useEffect(() => {
    if (!active || !conversation?.id) return;
    const id = conversation.id;
    let ended = false;
    const c = new AbortController();
    async function sync() {
      if (
        ended ||
        document.hidden ||
        sending.current ||
        resolving.current ||
        selected.current !== id
      )
        return;
      const revision = dataRevision.current;
      try {
        const data = await post<Snapshot>(
          "help/conversations/open",
          { id },
          c.signal,
        );
        if (
          !ended &&
          selected.current === id &&
          revision === dataRevision.current &&
          !sending.current &&
          !resolving.current
        )
          applySnapshot(data, true);
      } catch {}
    }
    const interval = pending
      ? window.setInterval(() => void sync(), 4000)
      : null;
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      ended = true;
      c.abort();
      if (interval) window.clearInterval(interval);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [active, conversation?.id, pending]);
  async function newConversation() {
    if (sending.current || resolving.current || loading) return;
    setLoading(true);
    setError("");
    try {
      const c = await post<Conversation>("help/conversations", {
        id: crypto.randomUUID(),
        month,
        currency,
      });
      selected.current = c.id;
      setConversation(c);
      setMessages([]);
      setHasOlder(false);
      setBefore(null);
      setHistoryOpen(false);
      setDraft("");
      retry.current = null;
      stickToBottom.current = true;
      void list().catch(() => {});
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Não foi possível criar a conversa.",
      );
    } finally {
      setLoading(false);
    }
  }
  async function older() {
    if (!conversation || !before || loading) return;
    setLoading(true);
    try {
      const data = await post<Snapshot>("help/conversations/open", {
        id: conversation.id,
        before,
      });
      preserveScroll.current = log.current
        ? { height: log.current.scrollHeight, top: log.current.scrollTop }
        : null;
      setMessages((old) => [...data.messages, ...old]);
      setBefore(data.before);
      setHasOlder(data.hasOlder);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Tente novamente.");
    } finally {
      setLoading(false);
    }
  }
  async function ask(question: string) {
    const q = question.trim();
    if (
      sending.current ||
      hidden ||
      referenceOnly ||
      loading ||
      pending ||
      q.length < 3 ||
      saving
    )
      return;
    sending.current = true;
    dataRevision.current++;
    setBusy(true);
    setError("");
    const c = new AbortController();
    request.current = c;
    try {
      let current = conversation;
      if (!current) {
        current = await post<Conversation>(
          "help/conversations",
          { id: crypto.randomUUID(), month, currency },
          c.signal,
        );
        selected.current = current.id;
        setConversation(current);
      }
      const turn =
        retry.current?.question === q && retry.current.external === external
          ? retry.current
          : { id: crypto.randomUUID(), question: q, external };
      retry.current = turn;
      stickToBottom.current = true;
      setMessages((old) => [
        ...old.filter(
          (m) => m.id !== turn.id + "-u" && m.id !== turn.id + "-a",
        ),
        { id: turn.id + "-u", role: "user", text: q },
      ]);
      setDraft("");
      const data = await post<{ messages: Message[] }>(
        "help/conversations/send",
        { id: current.id, request_id: turn.id, question: q, external },
        c.signal,
      );
      if (!c.signal.aborted && selected.current === current.id) {
        setMessages((old) => [
          ...old.filter((m) => !data.messages.some((n) => n.id === m.id)),
          ...data.messages,
        ]);
        retry.current = null;
        void list().catch(() => {});
      }
    } catch (e) {
      if (!c.signal.aborted) {
        setError(e instanceof Error ? e.message : "Tente novamente.");
        setDraft(q);
      }
    } finally {
      if (request.current === c) {
        setBusy(false);
        sending.current = false;
      }
    }
  }
  function stop() {
    request.current?.abort();
    setBusy(false);
    sending.current = false;
    setError(
      "A espera foi interrompida. A mensagem já enviada continua salva; atualize a conversa para conferir a resposta.",
    );
  }
  async function resolve(id: string, decision: "confirm" | "cancel") {
    if (
      resolving.current ||
      reader ||
      hidden ||
      referenceOnly ||
      busy ||
      loading
    )
      return;
    resolving.current = true;
    dataRevision.current++;
    setSaving(id);
    setError("");
    try {
      const result = await post<{ status: string }>("help/actions", {
        id,
        decision,
      });
      setMessages((ms) =>
        ms.map((m) =>
          m.action?.id === id
            ? { ...m, action: { ...m.action, status: result.status } }
            : m,
        ),
      );
      if (result.status === "confirmed")
        try {
          await refresh();
        } catch {
          setError(
            "A alteração foi salva. Atualize a página para recarregar os valores.",
          );
        }
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível salvar. Confira antes de tentar novamente.",
      );
    } finally {
      resolving.current = false;
      setSaving("");
    }
  }
  function keyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      window.matchMedia("(pointer:fine)").matches
    ) {
      e.preventDefault();
      void ask(draft);
    }
  }
  return (
    <section className="family-chat" aria-label="Conversa com Judite">
      {/* Cabeçalho: quem é (avatar, nome, modo — abre as configurações) à
          esquerda; ações da conversa, discretas, à direita. Sem caixas: a
          conversa é o conteúdo, o topo só orienta. */}
      <header className="chat-toolbar flex items-center gap-1 border-b border-base-300 pb-2">
        <button
          type="button"
          className="btn btn-ghost h-auto min-h-0 min-w-0 flex-1 justify-start gap-2.5 px-2 py-1.5 text-left font-normal"
          aria-expanded={settings}
          onClick={() => setSettings((s) => !s)}
        >
          <JuditeAvatar working={busy || pending} />
          <span className="flex min-w-0 flex-col">
            <strong className="text-sm leading-tight font-semibold">
              Judite
            </strong>
            <small className="truncate text-xs leading-tight text-base-content/70">
              {busy || pending
                ? "Respondendo…"
                : "Histórico da família · " +
                  (external ? "Com IA" : "Sem envio externo")}
            </small>
          </span>
          <Icon
            name="down"
            size={14}
            className={cx(
              "shrink-0 opacity-70 transition-transform duration-(--ds-dur)",
              settings && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm shrink-0 px-2.5 text-[0.8125rem] font-medium text-base-content/70 aria-expanded:bg-[var(--color-primary-tint)] aria-expanded:text-[var(--color-primary-ink)]"
          aria-label="Histórico de conversas"
          aria-expanded={historyOpen}
          disabled={busy || !!saving || hidden}
          onClick={() => {
            setHistoryOpen((v) => !v);
            void list().catch((e) => setError(e.message));
          }}
        >
          Histórico
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-circle shrink-0 text-base-content/70"
          disabled={busy || !!saving || loading || hidden}
          aria-label="Nova conversa"
          title="Nova conversa"
          onClick={() => void newConversation()}
        >
          <Icon name="plus" size={18} />
        </button>
      </header>
      {historyOpen && !hidden && (
        <div role="region" aria-label="Suas conversas salvas">
          <Panel title="Suas conversas">
            <div className="flex items-start justify-between gap-2">
              <p className="ds-caption">
                Privadas para o seu acesso. Novas conversas não apagam as
                anteriores.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-circle -mt-1 shrink-0 text-base-content/60"
                aria-label="Fechar histórico"
                onClick={() => setHistoryOpen(false)}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            {!conversations.length ? (
              <p className="ds-caption">
                A primeira conversa ficará salva aqui.
              </p>
            ) : (
              // Lista simples: título (1 linha) e mês embaixo; a conversa
              // aberta ganha o fundo tingido da marca, as outras só no hover.
              // Sem list-row (grade de colunas do daisyUI: recuava o item).
              <ul className="-mx-2 m-0 flex list-none flex-col gap-0.5 p-0">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="btn btn-ghost h-auto min-h-0 w-full flex-col items-start justify-start gap-0.5 px-2 py-2 text-left font-normal hover:bg-[var(--color-primary-tint)] aria-[current=true]:border-transparent aria-[current=true]:bg-[var(--color-primary-tint)]"
                      aria-current={
                        c.id === conversation?.id ? "true" : undefined
                      }
                      disabled={loading}
                      onClick={() => void choose(c.id)}
                    >
                      <span className="w-full truncate text-sm leading-snug font-medium">
                        {c.title}
                      </span>
                      <span className="text-xs leading-snug text-base-content/70 tabular-nums">
                        {c.month} · {c.currency}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasMore && (
              <Button
                disabled={loading}
                onClick={() =>
                  void list(true).catch((e) => setError(e.message))
                }
              >
                Carregar mais conversas
              </Button>
            )}
          </Panel>
        </div>
      )}
      {settings && !historyOpen && (
        <Panel>
          <p className="ds-caption">
            Consulte todos os meses da família. Diga o período na pergunta para
            focar ou comparar meses. Para alterações, informe mês, valor e data.
          </p>
          <p className="ds-caption">
            Suas conversas ficam salvas no banco privado, vinculadas ao seu
            acesso. Você pode retomá-las em outro aparelho; a outra pessoa da
            família tem seu próprio histórico.
          </p>
          {ready && !reader ? (
            // items-start: rótulo de 4 linhas, a caixinha fica na 1ª linha.
            <label className="family-consent m-0 flex items-start gap-2.5 rounded-box bg-base-200/60 p-3 text-[0.8125rem] leading-normal">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-px shrink-0"
                checked={external}
                disabled={busy}
                onChange={(e) => setExternal(e.target.checked)}
              />
              <span>
                Usar {provider}. Autorizo enviar minhas mensagens recentes,
                totais dos meses disponíveis, nomes e valores dos compromissos
                do período da pergunta, categorias e nomes das contas para
                interpretar meus pedidos. Extratos, documentos e senhas não são
                enviados. Evite escrever dados pessoais.
              </span>
            </label>
          ) : (
            <p className="ds-caption">
              {reader
                ? "Seu acesso permite apenas consultas locais."
                : "A IA externa ainda não está configurada. As consultas locais continuam disponíveis."}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => setSettings(false)}
            >
              Pronto
            </Button>
          </div>
        </Panel>
      )}
      {hidden ? (
        <div className="chat-empty">
          <span className="chat-emblem" aria-hidden="true">
            <Icon name="eye" size={24} />
          </span>
          <h2>Conversa protegida</h2>
          <p>Mostre os valores no topo para continuar.</p>
        </div>
      ) : (
        <>
          <div
            className="chat-log"
            ref={log}
            role="log"
            aria-label="Mensagens"
            aria-live={loading ? "off" : "polite"}
            aria-relevant="additions text"
            aria-busy={busy || loading}
            onScroll={() => {
              if (log.current)
                stickToBottom.current =
                  log.current.scrollHeight -
                    log.current.scrollTop -
                    log.current.clientHeight <
                  90;
            }}
          >
            {hasOlder && (
              <Button
                className="chat-older"
                disabled={loading}
                onClick={() => void older()}
              >
                Carregar mensagens anteriores
              </Button>
            )}
            {loading && (
              <p className="chat-loading" role="status">
                <span className="chat-dots" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Carregando conversa…
              </p>
            )}
            {!messages.length && !loading && (
              <div className="chat-empty">
                <span className="chat-emblem" aria-hidden="true">
                  <Icon name="sparkle" size={28} />
                </span>
                <h2>O que vamos cuidar hoje?</h2>
                <p>
                  Entenda o mês, planeje uma conta ou registre um gasto. Eu
                  preparo, vocês conferem.
                </p>
                <div className="chat-suggestions">
                  {[
                    ...(external
                      ? ["Analise nossas finanças e me diga onde melhorar"]
                      : []),
                    "O que falta pagar neste mês?",
                    "Quanto sobra no planejamento?",
                    ...(external
                      ? [
                          "Quero planejar uma conta",
                          "Quero registrar uma despesa",
                        ]
                      : ["Como estão nossos investimentos?"]),
                  ].map((q) => (
                    <Button key={q} disabled={busy} onClick={() => void ask(q)}>
                      {q}
                      <Icon
                        name="right"
                        size={14}
                        className="shrink-0 opacity-70"
                      />
                    </Button>
                  ))}
                </div>
                {external && (
                  <p>
                    Para uma análise completa, peça com palavras como
                    “analise”, “o que poderia fazer diferente”, “onde dá para
                    economizar” ou “o que está pesando nas finanças”.
                  </p>
                )}
                {!external && ready && !reader && (
                  <Button
                    className="chat-enable"
                    onClick={() => setSettings(true)}
                  >
                    Ativar conversa com IA
                  </Button>
                )}
              </div>
            )}
            {messages.map((m) => (
              <article
                className={`chat-message chat-${m.role} chat ${m.role === "user" ? "chat-end" : "chat-start"}`}
                key={m.id}
                aria-label={m.role === "user" ? "Você" : "Judite"}
              >
                {m.role === "assistant" && (
                  // Mesmo avatar do cabeçalho; no topo da mensagem (self-start),
                  // não no pé — em resposta longa ele ficava longe do começo.
                  <JuditeAvatar
                    size="sm"
                    working={m.pending}
                    className="chat-image self-start"
                  />
                )}
                <div
                  className={cx(
                    "chat-message-body chat-bubble",
                    m.role === "user"
                      ? "chat-bubble-primary"
                      : "bg-base-200 text-base-content",
                  )}
                >
                  {m.pending ? (
                    <JuditeInProgress />
                  ) : m.error ? (
                    <div className="flex items-start gap-2">
                      <Icon
                        name="alert"
                        size={16}
                        className="mt-[0.3rem] shrink-0 text-error"
                      />
                      <MessageText text={m.text} />
                    </div>
                  ) : (
                    <MessageText text={m.text} />
                  )}
                  {m.contas && (
                    <details className="chat-sources group mt-2 text-xs text-base-content/70">
                      <summary className="inline-flex min-h-0 cursor-pointer list-none items-center gap-1 rounded py-1 hover:text-base-content [&::-webkit-details-marker]:hidden">
                        Ver as contas
                        <Icon
                          name="down"
                          size={12}
                          className="transition-transform duration-(--ds-dur) group-open:rotate-180"
                        />
                      </summary>
                      <p className="m-0 mt-1 whitespace-pre-line leading-relaxed text-inherit">
                        {m.contas}
                      </p>
                    </details>
                  )}
                  {m.action && (
                    <div
                      role="region"
                      aria-label="Prévia da alteração"
                      className="mt-3"
                    >
                      <Panel
                        title={m.action.title}
                        meta={
                          m.action.status === "confirmed"
                            ? "✓ SALVO"
                            : m.action.status === "cancelled"
                              ? "CANCELADO"
                              : m.action.status === "expired"
                                ? "PRÉVIA EXPIRADA"
                                : "PRÉVIA · AINDA NÃO SALVO"
                        }
                      >
                        {/* Dados da prévia: linhas de 1 informação, então
                            lista compacta (8px) — o RowList (54px por linha)
                            é para linhas com título e detalhe. */}
                        <ul className="m-0 flex list-none flex-col divide-y divide-base-300 p-0 text-sm">
                          {m.action.details.map((d, i) => (
                            <li
                              key={i}
                              className="py-2 leading-snug [overflow-wrap:anywhere]"
                            >
                              {d}
                            </li>
                          ))}
                        </ul>
                        {m.action.status === "pending" && (
                          <>
                            <p className="ds-caption">
                              Válida por 30 minutos. Confira valores, contas e
                              datas.
                            </p>
                            <div className="chat-action-buttons flex flex-wrap gap-2">
                              <Button
                                variant="primary"
                                disabled={
                                  !!saving ||
                                  busy ||
                                  reader ||
                                  referenceOnly ||
                                  loading
                                }
                                onClick={() =>
                                  void resolve(m.action!.id, "confirm")
                                }
                              >
                                {saving === m.action.id
                                  ? "Processando…"
                                  : "Confirmar e salvar"}
                              </Button>
                              <Button
                                variant="quiet"
                                disabled={
                                  !!saving ||
                                  busy ||
                                  reader ||
                                  referenceOnly ||
                                  loading
                                }
                                onClick={() =>
                                  void resolve(m.action!.id, "cancel")
                                }
                              >
                                Cancelar
                              </Button>
                            </div>
                          </>
                        )}
                      </Panel>
                    </div>
                  )}
                  {m.origem && (
                    <p className="ds-caption mt-2">
                      {m.origem.externo
                        ? m.origem.modelo
                          ? `Com IA · ${m.origem.modelo}`
                          : "Com IA"
                        : "Sem envio externo"}
                    </p>
                  )}
                  {m.source && (
                    // Metadado da resposta, não conteúdo: link pequeno que
                    // abre o texto, sem caixa (era um bloco de 49px).
                    <details className="chat-sources group mt-2 text-xs text-base-content/70">
                      <summary className="inline-flex min-h-0 cursor-pointer list-none items-center gap-1 rounded py-1 hover:text-base-content [&::-webkit-details-marker]:hidden">
                        Fontes e limites da resposta
                        <Icon
                          name="down"
                          size={12}
                          className="transition-transform duration-(--ds-dur) group-open:rotate-180"
                        />
                      </summary>
                      <div className="mt-1 flex flex-col gap-1 leading-relaxed">
                        <p className="m-0 text-inherit">{m.source}</p>
                        <p className="m-0 text-inherit">{m.coverage}</p>
                      </div>
                    </details>
                  )}
                </div>
              </article>
            ))}
            {busy && <JuditeWaiting onStop={stop} />}
          </div>
          <div className="chat-compose-wrap">
            {referenceOnly && (
              <p className="ds-caption">
                Esta conversa em {conversation?.currency} fica como referência.{" "}
                <Button
                  disabled={loading}
                  onClick={() => void newConversation()}
                >
                  Conversar em reais
                </Button>
              </p>
            )}
            {error && (
              <p
                className="family-error alert alert-soft alert-error"
                role="alert"
              >
                {error}{" "}
                {conversation && (
                  <Button
                    type="button"
                    disabled={busy || loading}
                    onClick={() => void choose(conversation.id)}
                  >
                    Atualizar conversa
                  </Button>
                )}
              </p>
            )}
            {/* Compositor: uma pílula só. Anexar (discreto) · texto que cresce
                com o conteúdo (1 a ~6 linhas) · enviar (primário). Botões no
                pé (items-end): com várias linhas, ficam junto da última. */}
            <form
              className="chat-composer m-0 flex items-end gap-1 rounded-[1.375rem] border border-base-300 bg-base-100 p-1 shadow-none transition-[border-color,box-shadow] duration-(--ds-dur-fast) focus-within:border-primary focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-primary)_22%,transparent)]"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-circle shrink-0 text-base-content/70"
                aria-label="Abrir formulário de movimento"
                title="Registrar pelo formulário"
                disabled={
                  reader || referenceOnly || !!saving || busy || loading
                }
                onClick={record}
              >
                <Icon name="plus" size={20} />
              </button>
              <label className="sr-only" htmlFor="chat-draft">
                Mensagem para Judite
              </label>
              <textarea
                id="chat-draft"
                name="message"
                autoComplete="off"
                enterKeyHint="enter"
                disabled={loading || referenceOnly}
                ref={input}
                rows={1}
                // field-sizing: cresce com o texto, sem JS; 40px = altura dos
                // botões, então 1 linha fica centrada entre eles.
                className="min-h-[calc(var(--size-field,0.25rem)*10)] max-h-36 flex-1 resize-none px-1 py-2 text-[0.9375rem] leading-6 [field-sizing:content]"
                maxLength={600}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={keyDown}
                placeholder={
                  external
                    ? "Pergunte ou peça para registrar…"
                    : "Pergunte sobre o nosso mês…"
                }
              />
              {busy ? (
                <button
                  type="button"
                  className="btn btn-circle shrink-0 border-0 bg-base-content text-base-100"
                  onClick={stop}
                  aria-label="Parar a espera"
                  title="Parar a espera"
                >
                  <span
                    className="size-3 rounded-[3px] bg-current"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <button
                  type="submit"
                  className="btn btn-primary btn-circle shrink-0 disabled:bg-base-200 disabled:text-base-content/30"
                  disabled={
                    draft.trim().length < 3 ||
                    !!saving ||
                    loading ||
                    pending ||
                    referenceOnly
                  }
                  aria-label="Enviar mensagem"
                >
                  <Icon name="up" size={18} />
                </button>
              )}
            </form>
            <p className="chat-disclaimer m-0 mt-1.5 px-2 text-center text-xs leading-snug text-base-content/70">
              {external
                ? "A IA pode errar. Alterações só são salvas ao confirmar."
                : "Ajuda local para consultas. Ative a IA acima para pedir registros e edições."}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
