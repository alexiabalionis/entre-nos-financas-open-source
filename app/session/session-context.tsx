"use client";
import { createContext, useContext } from "react";
import type { Preferences } from "../../src/domain/preferences";
import type { AuthUser } from "../hooks/use-auth.ts";

/**
 * Fatos da sessão que várias páginas leem ou alteram: quem está logada, as
 * preferências (tema, ordem do início, foto) e o "ocultar valores". É o único
 * estado compartilhado entre as páginas; dados de tela (mês, membros) ficam
 * em cada página.
 */
export type Session = {
  user: AuthUser;
  /** Leitora (somente leitura): desabilita gravações. */
  reader: boolean;
  preferences: Preferences;
  /** false até as preferências desta pessoa chegarem. */
  preferencesLoaded: boolean;
  updatePreferences: (p: Preferences) => void;
  hidden: boolean;
  setHidden: (hidden: boolean) => void;
  /** Reabre o tour guiado (botão no Meu perfil). */
  replayTour: () => void;
  /** Encerra a sessão e volta para a tela de entrada. */
  signOut: () => Promise<void>;
  /** Elemento do cabeçalho onde o Mês coloca a saudação. */
  headerSlot: HTMLElement | null;
};

const SessionContext = createContext<Session | null>(null);

export const SessionProvider = SessionContext.Provider;

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession fora do AppShell.");
  return session;
}
