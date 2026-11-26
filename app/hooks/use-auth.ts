"use client";
/**
 * Hook de sessão. Uma responsabilidade: saber QUEM está logado. Busca
 * `auth/status` uma vez (e sob demanda via reload) e expõe o estado de auth.
 * Não sabe de mês, dados nem preferências — quem precisa do usuário recebe
 * `auth.user` por argumento. Porta a parte de auth do load() de family.tsx.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";

export type AuthUser = {
  name: string;
  role: string;
  email: string;
  administrator?: boolean;
};

export type AuthStatus = {
  configured: boolean;
  hosted?: boolean;
  user: AuthUser | null;
};

export type UseAuth = {
  /** null enquanto carrega; depois o status resolvido. */
  auth: AuthStatus | null;
  /** Atalho para auth?.user (null se deslogada ou ainda carregando). */
  user: AuthUser | null;
  error: string;
  /** Rebusca o status (ex.: após login/logout). */
  reload: () => Promise<void>;
};

export function useAuth(): UseAuth {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const next = await api<AuthStatus>("auth/status");
      // Só troca o estado se o conteúdo mudou. Sem isso, cada reload (ex.: o
      // StrictMode em dev chama o efeito 2x) cria um objeto novo, muda a
      // referência de `user`, e dispara refetch/re-render em cascata nos hooks
      // que dependem dele — o que fazia os dados do mês piscarem.
      setAuth((prev) => {
        const same = prev && JSON.stringify(prev) === JSON.stringify(next);
        return same ? prev : next;
      });
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao verificar a sessão.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { auth, user: auth?.user ?? null, error, reload };
}
