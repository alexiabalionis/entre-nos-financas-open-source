"use client";
/**
 * Membros do casal (`members`). Usado pela saudação do Mês e pelo cartão
 * "Nosso casal" do Nosso espaço; cada tela busca ao montar e o cartão
 * rebusca depois de criar um acesso.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { AuthUser } from "./use-auth.ts";

export function useMembers(enabled: boolean) {
  const [members, setMembers] = useState<AuthUser[]>([]);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    setMembers((await api<{ members: AuthUser[] }>("members")).members);
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let ended = false;
    void api<{ members: AuthUser[] }>("members")
      .then((m) => {
        if (!ended) setMembers(m.members);
      })
      .catch((e: Error) => {
        if (!ended) setError(e.message);
      });
    return () => {
      ended = true;
    };
  }, [enabled]);
  return { members, error, reload };
}
