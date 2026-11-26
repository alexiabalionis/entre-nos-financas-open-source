"use client";
// Rota da tela Mês (origem: preview descartável). Compõe os hooks reais
// (auth + navegação de mês + dados do mês). Quando NÃO logada, mostra um login
// leve (mesma API auth/login do app) — porque a home trava em alguns devices e
// esta rota serve como porta de entrada para validar com dados reais. Quando
// logada, renderiza a tela Mês SÓ com os dados reais do banco — sem mock, sem
// fallback. Logs de diagnóstico no console rastreiam cada render para caçar o
// "pisca" dos dados.
import { useEffect, useState, type FormEvent } from "react";
import { MonthScreen } from "../month-screen.tsx";
import { useAuth } from "../hooks/use-auth.ts";
import { useMonth } from "../hooks/use-month.ts";
import { useMonthData } from "../hooks/use-month-data.ts";
import { useRefreshOnReturn } from "../hooks/use-refresh-on-return.ts";
import {
  useBankReadDue,
  notifyBanksUpdated,
} from "../hooks/use-bank-read-due.ts";
import { api } from "../lib/api.ts";
import type { Currency } from "../../src/domain/finance.ts";
import {
  balanceCentsFor,
  monthCategories,
  projectionScreen,
} from "../month/screen-input.ts";

export default function PreviewMes() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { user, auth, reload } = useAuth();
  const { month, setMonth } = useMonth();
  const currency = "BRL" as const satisfies Currency;
  const { data, projection, loading, error, reload: reloadMonth } = useMonthData(
    month,
    currency,
    user?.email ?? null,
  );

  // Atualiza sozinha: ao voltar para a aba e quando os bancos são relidos.
  useBankReadDue(!!user && user.role !== "reader", notifyBanksUpdated);
  useRefreshOnReturn(reloadMonth, !!user);

  // Guard do family.tsx: só confia nos itens quando o `data` em mãos é do mês
  // e da moeda pedidos (sem isso, mostra itens do mês errado durante o fetch).
  const periodReady =
    !!data &&
    data.state.month === month + "-01" &&
    data.state.currency === currency;
  // Dados reais são a ÚNICA fonte. Sem mock, sem fallback: mês sem itens mostra
  // o mês real vazio.
  const items = periodReady
    ? data!.routine.items.filter((i) => i.currency === currency)
    : [];
  const categories = periodReady ? monthCategories(data!.state.categories) : [];
  // Saldo atual: soma dos saldos das contas na moeda corrente (centavos). Só
  // quando o período carregou e há conta com saldo conhecido; senão null, e a
  // tela mostra "informe o saldo" (sem inventar projeção).
  const balanceCents = periodReady
    ? balanceCentsFor(data!.state.accounts, currency)
    : null;

  // Projeção de caixa (motor F0/F1): projectionScreen (app/month/screen-input.ts)
  // junta a conversão do retrato do coletor (wireToView — recorte de
  // horizonte/mês, só confia na projeção do mês pedido em modo current/future)
  // com o fallback local de modo (monthMode) quando a projeção falhou e não há
  // busca em voo, pra um mês 2+ à frente mostrar o aviso em vez de conteúdo
  // normal.
  const screen = projectionScreen(
    projection,
    month,
    loading,
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
    }).format(new Date()),
  );

  // LOG DE DIAGNÓSTICO: imprime, A CADA render, qual VISTA a tela mostra agora
  // (carregando / login / mês real). O "pisca" é a vista alternando; o console
  // mostra a sequência exata. Remover quando confirmado.
  const view = !auth
    ? "LOADING(auth)"
    : !user
      ? "LOGIN"
      : loading || !periodReady
        ? "LOADING(mes)"
        : items.length === 0
          ? "EMPTY"
          : "REAL";
  console.log("[preview-mes] view=" + view, {
    hasData: !!data,
    dataMonth: data?.state.month ?? null,
    periodReady,
    itemsLen: items.length,
    loading,
  });

  // Aplica o tema no :root via effect (não no render) para não divergir a
  // hidratação SSR/cliente.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Login leve: reusa a API auth/login do app; no sucesso, recarrega o auth.
  const [busy, setBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  async function onLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setLoginError("");
    try {
      await api("auth/login", form);
      await reload();
    } catch (err) {
      setLoginError(
        err instanceof Error ? err.message : "Não foi possível entrar.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    try {
      await api("auth/logout", {});
    } catch {
      // ignora erro de rede: o recarregar do auth reflete o estado real.
    }
    await reload();
  }

  const themeToggle = (
    <button
      type="button"
      className="ds-chip"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      Tema: {theme === "light" ? "claro" : "escuro"}
    </button>
  );

  // auth ainda carregando: aguarda (evita piscar o login antes de saber).
  if (!auth) {
    return (
      <div
        className="family-app"
        style={{ minHeight: "100dvh", background: "var(--family-bg)" }}
      >
        <div style={{ textAlign: "center", padding: "40px 18px" }}>
          <p className="ds-caption">Carregando…</p>
        </div>
      </div>
    );
  }

  // Não logada: formulário de login (mesma API do app). É a porta de entrada
  // desta rota quando a home trava no device. Sem prévia de exemplo — a tela
  // só mostra dados reais depois do login.
  if (!user) {
    return (
      <div
        className="family-app"
        style={{ minHeight: "100dvh", background: "var(--family-bg)" }}
      >
        <div
          style={{ maxWidth: 430, margin: "0 auto", padding: "40px 22px 60px" }}
        >
          <div style={{ display: "flex", justifyContent: "center" }}>
            {themeToggle}
          </div>
          <h1 style={{ marginTop: 24 }}>Entrar para ver o mês</h1>
          <p className="ds-caption" style={{ marginBottom: 20 }}>
            Entre com a conta do app para ver os dados do seu mês.
          </p>
          <form onSubmit={onLogin} style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              E-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                spellCheck={false}
                required
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                minLength={12}
                maxLength={128}
                required
              />
            </label>
            {loginError ? (
              <p className="family-error" role="alert">
                {loginError}
              </p>
            ) : null}
            <button type="submit" className="ds-button primary" disabled={busy}>
              {busy ? "Entrando…" : "Entrar"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Logada: tela Mês só com dados reais. Enquanto o período do `data` em mãos
  // não bate com o mês pedido, mostramos "carregando" em vez de dados de outro
  // mês — sem nunca cair em mock.
  return (
    <div
      className="family-app"
      style={{ minHeight: "100dvh", background: "var(--family-bg)" }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          flexDirection: "column",
          alignItems: "center",
          padding: "10px 0",
          borderBottom: "1px solid var(--family-line)",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          {themeToggle}
          <button type="button" className="ds-chip" onClick={onLogout}>
            Sair
          </button>
        </div>
        {error && !loading ? (
          <>
            <p className="family-error" role="alert">
              Não foi possível carregar o mês.
            </p>
            <button
              type="button"
              className="ds-button"
              onClick={() => void reloadMonth()}
            >
              Tentar de novo
            </button>
          </>
        ) : loading || !periodReady ? (
          <p className="ds-caption">Carregando o mês…</p>
        ) : items.length === 0 ? (
          <p className="ds-caption">Este mês ainda não tem lançamentos.</p>
        ) : null}
      </div>
      <div style={{ maxWidth: 430, margin: "0 auto", padding: "0 18px 60px" }}>
        {periodReady ? (
          <MonthScreen
            items={items}
            categories={categories}
            month={month}
            currency={currency}
            onMoveMonth={setMonth}
            people={[{ name: user.name }]}
            balanceCents={balanceCents}
            projection={screen.view}
            mode={screen.mode}
            statusWord={screen.statusWord}
          />
        ) : null}
      </div>
    </div>
  );
}
