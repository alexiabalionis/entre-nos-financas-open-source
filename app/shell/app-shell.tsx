"use client";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LoginGate, OpeningScreen } from "./login-gate";
import { APP_ROUTES, titleFor, withMonth } from "./routes.ts";
import { SessionProvider, type Session } from "../session/session-context";
import { JuditeKeepAlive } from "../chat/judite-keep-alive";
import { HeaderAvatar } from "../header-avatar";
import { FamilyIcon } from "../family-extras";
import { IconButton } from "../ds/icon-button.tsx";
import { AppOverview } from "../family-personalization";
import { useAuth, type AuthUser } from "../hooks/use-auth.ts";
import { api } from "../lib/api.ts";
import { usePreferences } from "../hooks/use-preferences.ts";
import { monthCache } from "../hooks/use-month-data.ts";
import { useMonthParam } from "../hooks/use-month-param.ts";
import {
  useBankReadDue,
  notifyBanksUpdated,
} from "../hooks/use-bank-read-due.ts";
import {
  BANKS_UPDATED_EVENT,
  useRefreshOnReturn,
} from "../hooks/use-refresh-on-return.ts";
import { defaultPreferences } from "../../src/domain/preferences";

/**
 * Casca do app: só o que atravessa as páginas. Porta de login, sessão
 * (pessoa, preferências, ocultar valores), tema, cabeçalho, barra de baixo, tour
 * guiado e a Judite sempre montada. Não busca nem guarda dados de tela.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { auth, error, reload } = useAuth();
  if (!auth) return <OpeningScreen error={error} />;
  if (!auth.user) return <LoginGate auth={auth} onDone={reload} />;
  return (
    <SignedIn user={auth.user} reloadAuth={reload}>
      {children}
    </SignedIn>
  );
}

function SignedIn({
  user,
  reloadAuth,
  children,
}: {
  user: AuthUser;
  reloadAuth: () => Promise<void>;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { month, hasParam, setMonth } = useMonthParam();
  const prefs = usePreferences(user);
  const { reload: reloadPreferences } = prefs;
  const [hidden, setHidden] = useState(false),
    [tourReplay, setTourReplay] = useState(false),
    [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  // A URL sempre carrega o mês (como a antiga): congela o mês atual na abertura.
  useEffect(() => {
    if (!hasParam) setMonth(month);
  }, [hasParam, month, setMonth]);

  useEffect(() => {
    const p = prefs.preferences ?? defaultPreferences;
    // "system" = sem atributo: assim o daisyUI (prefersdark) e o CSS antigo
    // seguem o tema do aparelho juntos.
    if (p.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = p.theme;
    // Cache para o script de boot do layout aplicar antes da primeira pintura.
    try {
      localStorage.setItem("entre-nos-theme-v1", p.theme);
    } catch {}
    // O destaque agora vem do tema daisyUI (--color-primary). A cor escolhida
    // na personalização não é mais aplicada inline (inline venceria o tema);
    // limpa o valor que uma versão anterior possa ter deixado.
    document.documentElement.style.removeProperty("--family-accent");
    document.documentElement.style.removeProperty("--family-on-accent");
  }, [prefs.preferences]);

  // Cache do mês: bancos relidos marcam os dados como velhos; sair ou trocar
  // de pessoa esvazia (e invalida buscas em voo).
  useEffect(() => {
    const stale = () => monthCache.markStale();
    window.addEventListener(BANKS_UPDATED_EVENT, stale);
    return () => {
      window.removeEventListener(BANKS_UPDATED_EVENT, stale);
      monthCache.clear();
    };
  }, [user.email]);

  const reader = user.role === "reader";
  useBankReadDue(!reader, notifyBanksUpdated);
  // Ao voltar para a aba: relê sessão e preferências (expiração, outro aparelho).
  const reloadSession = useCallback(async () => {
    await reloadAuth();
    await reloadPreferences();
  }, [reloadAuth, reloadPreferences]);
  useRefreshOnReturn(reloadSession, true);

  const go = useCallback(
    (path: string) => {
      if (path !== pathname) router.push(withMonth(path, month), { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [pathname, month, router],
  );

  const session = useMemo<Session>(
    () => ({
      user,
      reader,
      preferences: prefs.preferences,
      preferencesLoaded: prefs.loaded,
      updatePreferences: prefs.updatePreferences,
      hidden,
      setHidden,
      replayTour: () => setTourReplay(true),
      signOut: async () => {
        await api("auth/logout", {});
        await reloadAuth();
      },
      headerSlot,
    }),
    [user, reader, prefs.preferences, prefs.loaded, prefs.updatePreferences, hidden, headerSlot, reloadAuth],
  );

  return (
    <SessionProvider value={session}>
      <div className={`family-app${pathname === "/judite" ? " is-chat" : ""}`}>
        <a className="skip-link" href="#family-content">
          Ir para o mês
        </a>
        <header className="family-header navbar min-h-0 bg-base-200/90 backdrop-blur">
          <span className="family-header-slot" ref={setHeaderSlot} />
          <h1 className="sr-only">{titleFor(pathname)}</h1>
          <IconButton
            icon="eye"
            label={hidden ? "Mostrar valores" : "Ocultar valores"}
            pressed={hidden}
            onClick={() => setHidden(!hidden)}
          />
          <button
            className="family-icon btn btn-ghost btn-circle"
            data-tour="profile"
            aria-label="Nosso espaço e configurações"
            onClick={() => go("/espaco")}
          >
            <HeaderAvatar
              key={user.email + ":" + (prefs.preferences.revision ?? 0)}
              hasPhoto={prefs.preferences.has_photo ?? false}
              revision={prefs.preferences.revision ?? 0}
              name={user.name}
            />
          </button>
        </header>
        <main id="family-content" className="family-main">
          {children}
          <JuditeKeepAlive active={pathname === "/judite"} />
        </main>
        {prefs.loaded && (
          <AppOverview
            key={user.email}
            preferences={prefs.preferences}
            onSaved={prefs.updatePreferences}
            replay={tourReplay}
            // O tour aponta para elementos do Mês: abre a tela do Mês primeiro.
            onStart={() => {
              if (pathname !== "/") go("/");
            }}
            onClose={() => setTourReplay(false)}
          />
        )}
        <nav
          data-tour="navigation"
          className="family-nav dock dock-sm bg-base-100 border-t border-base-300"
          aria-label="Áreas da família"
        >
          {APP_ROUTES.flatMap((r) =>
            r.nav ? [{ path: r.path, ...r.nav }] : [],
          ).map((item) => (
            <button
              key={item.path}
              className={pathname === item.path ? "dock-active text-primary bg-transparent" : "text-base-content/70 bg-transparent"}
              aria-current={pathname === item.path ? "page" : undefined}
              onClick={() => go(item.path)}
            >
              <span aria-hidden="true">
                <FamilyIcon name={item.icon} />
              </span>
              <span className="dock-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </SessionProvider>
  );
}
