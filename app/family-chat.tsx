"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "./ds/button.tsx";
import { IconButton } from "./ds/icon-button.tsx";
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
    <section className="family-chat flex min-h-0 flex-1 flex-col gap-3" aria-label="Conversa com Judite">
      {/* Cabeçalho: quem é (avatar, nome, modo — abre as configurações) à
          esquerda; ações da conversa, discretas, à direita. Sem caixas: a
          conversa é o conteúdo, o topo só orienta. */}
      <header className="chat-toolbar flex items-center gap-1.5 border-b border-border pb-2.5">
        <button
          type="button"
          className="ui-reset-btn flex min-w-0 flex-1 items-center justify-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
          aria-expanded={settings}
          onClick={() => setSettings((s) => !s)}
        >
          <JuditeAvatar working={busy || pending} />
          <span className="flex min-w-0 flex-col">
            <strong className="text-[0.9375rem] leading-tight font-semibold text-ink">
              Judite
            </strong>
            <small className="truncate text-[0.75rem] leading-tight text-ink-2">
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
              "shrink-0 text-ink-2 transition-transform duration-(--ds-dur)",
              settings && "rotate-180",
            )}
          />
        </button>
        <button
          type="button"
          className="ui-reset-btn inline-flex min-h-8.5 shrink-0 items-center rounded-xl px-3 text-[0.8125rem] font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-50 aria-expanded:bg-accent-soft aria-expanded:text-accent-ink"
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
        <IconButton
          icon="plus"
          label="Nova conversa"
          disabled={busy || !!saving || loading || hidden}
          onClick={() => void newConversation()}
        />
      </header>
      {historyOpen && !hidden && (
        <div role="region" aria-label="Suas conversas salvas">
          <Panel title="Suas conversas">
            <div className="flex items-start justify-between gap-2">
              <p className="text-[0.875rem] text-ink-2">
                Privadas para o seu acesso. Novas conversas não apagam as
                anteriores.
              </p>
              <IconButton
                icon="close"
                label="Fechar histórico"
                onClick={() => setHistoryOpen(false)}
              />
            </div>
            {!conversations.length ? (
              <p className="text-[0.875rem] text-ink-2">
                A primeira conversa ficará salva aqui.
              </p>
            ) : (
              <ul className="-mx-2 m-0 flex list-none flex-col gap-1 p-0">
                {conversations.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="ui-reset-btn flex w-full flex-col items-start justify-start gap-0.5 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent-soft/60 disabled:opacity-50 aria-[current=true]:bg-accent-soft aria-[current=true]:text-accent-ink"
                      aria-current={
                        c.id === conversation?.id ? "true" : undefined
                      }
                      disabled={loading}
                      onClick={() => void choose(c.id)}
                    >
                      <span className="w-full truncate text-[0.9375rem] leading-snug font-medium text-ink">
                        {c.title}
                      </span>
                      <span className="text-[0.75rem] leading-snug text-ink-2 tabular-nums">
                        {c.month} · {c.currency}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {hasMore && (
              <Button
                variant="quiet"
                size="sm"
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
        <Panel title="Como a Judite funciona">
          <p className="text-[0.875rem] leading-relaxed text-ink-2">
            Consulte todos os meses da família. Diga o período na pergunta para
            focar ou comparar meses. Para alterações, informe mês, valor e data.
          </p>
          <p className="text-[0.875rem] leading-relaxed text-ink-2">
            Suas conversas ficam salvas no banco privado, vinculadas ao seu
            acesso. Você pode retomá-las em outro aparelho; a outra pessoa da
            família tem seu próprio histórico.
          </p>
          {ready && !reader ? (
            <label className="m-0 flex cursor-pointer items-start gap-2.5 rounded-xl border border-border bg-surface-2 p-3 text-[0.8125rem] leading-relaxed text-ink">
              <input
                type="checkbox"
                className="mt-1 size-4 shrink-0 rounded border-border accent-accent"
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
            <p className="text-[0.875rem] text-ink-2">
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
        <div className="chat-empty flex flex-1 flex-col items-center justify-center gap-3 px-4 py-12 text-center">
          <span
            className="flex size-14 items-center justify-center rounded-2xl bg-surface-2 text-ink-2"
            aria-hidden="true"
          >
            <Icon name="eye" size={24} />
          </span>
          <h2 className="font-display text-xl font-medium tracking-tight text-ink">
            Conversa protegida
          </h2>
          <p className="max-w-sm text-[0.9375rem] text-ink-2">
            Mostre os valores no topo para continuar.
          </p>
        </div>
      ) : (
        <>
          <div
            className="chat-log flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pr-1"
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
              <div className="flex justify-center py-1">
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={loading}
                  onClick={() => void older()}
                >
                  Carregar mensagens anteriores
                </Button>
              </div>
            )}
            {loading && (
              <p className="flex items-center justify-center gap-2 py-4 text-[0.875rem] text-ink-2" role="status">
                <span className="chat-dots text-accent-ink" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                Carregando conversa…
              </p>
            )}
            {!messages.length && !loading && (
              <div className="chat-empty mx-auto flex max-w-lg flex-1 flex-col items-center justify-center gap-4 px-2 py-8 text-center">
                <span
                  className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"
                  aria-hidden="true"
                >
                  <Icon name="sparkle" size={26} />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h2 className="font-display text-[1.375rem] leading-tight font-medium tracking-tight text-ink">
                    O que vamos cuidar hoje?
                  </h2>
                  <p className="text-[0.9375rem] leading-relaxed text-ink-2">
                    Entenda o mês, planeje uma conta ou registre um gasto. Eu
                    preparo, vocês conferem.
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2">
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
                    <button
                      key={q}
                      type="button"
                      disabled={busy}
                      onClick={() => void ask(q)}
                      className="ui-reset-btn flex w-full items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left text-[0.9375rem] font-medium text-ink transition-colors hover:border-border-strong hover:bg-surface-2 disabled:opacity-50"
                    >
                      <span>{q}</span>
                      <Icon
                        name="right"
                        size={16}
                        className="shrink-0 text-ink-2"
                      />
                    </button>
                  ))}
                </div>
                {external && (
                  <p className="text-[0.8125rem] leading-relaxed text-ink-2">
                    Para uma análise completa, peça com palavras como
                    “analise”, “o que poderia fazer diferente”, “onde dá para
                    economizar” ou “o que está pesando nas finanças”.
                  </p>
                )}
                {!external && ready && !reader && (
                  <Button
                    variant="primary"
                    onClick={() => setSettings(true)}
                  >
                    Ativar conversa com IA
                  </Button>
                )}
              </div>
            )}
            {messages.map((m) => (
              <article
                className={cx(
                  "chat-message flex gap-2.5",
                  m.role === "user" ? "justify-end" : "items-start justify-start",
                )}
                key={m.id}
                aria-label={m.role === "user" ? "Você" : "Judite"}
              >
                {m.role === "assistant" && (
                  // Mesmo avatar do cabeçalho; no topo da mensagem, não no pé.
                  <JuditeAvatar
                    size="sm"
                    working={m.pending}
                    className="mt-0.5"
                  />
                )}
                <div
                  className={cx(
                    "min-w-0 text-[0.9375rem] leading-relaxed shadow-xs [overflow-wrap:anywhere]",
                    m.role === "user"
                      ? "max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-white sm:max-w-[75%]"
                      : "max-w-[88%] rounded-2xl rounded-tl-md border border-border bg-surface px-4 py-3 text-ink sm:max-w-[80%]",
                  )}
                >
                  {m.pending ? (
                    <JuditeInProgress />
                  ) : m.error ? (
                    <div className="flex items-start gap-2">
                      <Icon
                        name="alert"
                        size={16}
                        className="mt-1 shrink-0 text-danger"
                      />
                      <MessageText text={m.text} />
                    </div>
                  ) : (
                    <MessageText text={m.text} />
                  )}
                  {m.contas && (
                    <details className="group mt-2.5 text-[0.75rem] text-ink-2">
                      <summary className="inline-flex min-h-0 cursor-pointer list-none items-center gap-1 rounded py-1 hover:text-ink [&::-webkit-details-marker]:hidden">
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
                        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0 text-[0.875rem]">
                          {m.action.details.map((d, i) => (
                            <li
                              key={i}
                              className="py-2 leading-snug text-ink [overflow-wrap:anywhere]"
                            >
                              {d}
                            </li>
                          ))}
                        </ul>
                        {m.action.status === "pending" && (
                          <>
                            <p className="text-[0.8125rem] text-ink-2">
                              Válida por 30 minutos. Confira valores, contas e
                              datas.
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                variant="primary"
                                size="sm"
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
                                size="sm"
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
                    <p
                      className={cx(
                        "mt-2 text-[0.75rem]",
                        m.role === "user" ? "text-white/80" : "text-ink-2",
                      )}
                    >
                      {m.origem.externo
                        ? m.origem.modelo
                          ? `Com IA · ${m.origem.modelo}`
                          : "Com IA"
                        : "Sem envio externo"}
                    </p>
                  )}
                  {m.source && (
                    <details className="group mt-2 text-[0.75rem] text-ink-2">
                      <summary className="inline-flex min-h-0 cursor-pointer list-none items-center gap-1 rounded py-1 hover:text-ink [&::-webkit-details-marker]:hidden">
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
          <div className="chat-compose-wrap flex shrink-0 flex-col gap-2 pt-1">
            {referenceOnly && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3.5 py-2 text-[0.875rem] text-ink-2">
                <span>
                  Esta conversa em {conversation?.currency} fica como referência.
                </span>
                <Button
                  variant="quiet"
                  size="sm"
                  disabled={loading}
                  onClick={() => void newConversation()}
                >
                  Conversar em reais
                </Button>
              </div>
            )}
            {error && (
              <div
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-2.5 text-[0.875rem] text-danger"
                role="alert"
              >
                <span>{error}</span>
                {conversation && (
                  <Button
                    variant="quiet"
                    size="sm"
                    disabled={busy || loading}
                    onClick={() => void choose(conversation.id)}
                  >
                    Atualizar conversa
                  </Button>
                )}
              </div>
            )}
            {/* Compositor: uma pílula só. Anexar (discreto) · texto que cresce
                com o conteúdo (1 a ~6 linhas) · enviar (primário). Botões no
                pé (items-end): com várias linhas, ficam junto da última. */}
            <form
              className="chat-composer m-0 flex items-end gap-1.5 rounded-[1.375rem] border border-border bg-surface p-1.5 shadow-xs transition-[border-color,box-shadow] duration-(--ds-dur-fast) focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
              onSubmit={(e) => {
                e.preventDefault();
                void ask(draft);
              }}
            >
              <IconButton
                icon="plus"
                label="Abrir formulário de movimento"
                disabled={
                  reader || referenceOnly || !!saving || busy || loading
                }
                onClick={record}
              />
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
                className="min-h-10 max-h-36 flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-base leading-6 text-ink placeholder:text-ink-3 focus:outline-none [@media(pointer:fine)]:text-[0.9375rem] [field-sizing:content]"
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
                  className="ui-reset-btn grid size-10 shrink-0 place-items-center rounded-full bg-ink text-surface transition-opacity hover:opacity-90"
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
                  className="ui-reset-btn grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-all hover:brightness-95 disabled:bg-surface-3 disabled:text-ink-3"
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
            <p className="chat-disclaimer m-0 mt-1 px-2 text-center text-[0.75rem] leading-snug text-ink-2">
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
