"use client";
/**
 * Hook de preferências. Uma responsabilidade: buscar e gerenciar as
 * PREFERÊNCIAS da pessoa (tema/accent/ordem de cards). Porta a parte de
 * preferências do load() de family.tsx. Quem precisa aplicar tema/accent no
 * DOM faz isso no consumidor — este hook só gerencia o dado.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import {
  defaultPreferences,
  type Preferences,
} from "../../src/domain/preferences.ts";
import type { AuthUser } from "./use-auth.ts";

export type UsePreferences = {
  /** Preferências efetivas: defaultPreferences enquanto não há logada/dado. */
  preferences: Preferences;
  /** false até as preferências DESTA pessoa chegarem (evita abrir o tour cedo). */
  loaded: boolean;
  /** Atualiza só o estado local (gancho para persistir depois). */
  updatePreferences: (p: Preferences) => void;
  /** Rebusca as preferências da pessoa logada. */
  reload: () => Promise<void>;
};

export function usePreferences(user: AuthUser | null): UsePreferences {
  const [personal, setPersonal] = useState<{
    email: string;
    preferences: Preferences;
  } | null>(null);

  const reload = useCallback(async () => {
    if (!user) {
      setPersonal(null);
      return;
    }
    const prefs = await api<Preferences>("profile/preferences");
    setPersonal((prior) =>
      prior?.email === user.email &&
      prior.preferences.revision >= prefs.revision &&
      (!prefs.onboarding_done || prior.preferences.onboarding_done)
        ? prior
        : { email: user.email, preferences: prefs },
    );
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const updatePreferences = useCallback(
    (p: Preferences) => {
      if (user) setPersonal({ email: user.email, preferences: p });
    },
    [user],
  );

  const loaded = !!user && personal?.email === user.email;
  const preferences =
    loaded && personal ? personal.preferences : defaultPreferences;

  return { preferences, loaded, updatePreferences, reload };
}
