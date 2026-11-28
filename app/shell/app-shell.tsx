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
import {
  defaultPreferences,
  resolveAccentPreset,
} from "../../src/domain/preferences";

/** Marca do Entre Nós: duas formas ascendentes unidas por um coração. */
function BrandMark() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 28 28"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="28" height="28" rx="8" className="fill-accent-soft" />
      <path
        d="M7 20.5C7 15.8 9.6 12.2 13.4 10.6"
        stroke="var(--ui-accent)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M21 20.5C21 15.8 18.4 12.2 14.6 10.6"
        stroke="var(--ui-lime)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M14 11.4c-.7-1.1-2.4-1-2.8.3-.3 1.1.7 2.2 2.8 3.5 2.1-1.3 3.1-2.4 2.8-3.5-.4-1.3-2.1-1.4-2.8-.3Z"
        fill="var(--ui-accent)"
      />
    </svg>
  );
}

/**
 * Casca adaptativa do app: sidebar limpa no desktop (`lg:`), barra superior e
 * dock inferior no mobile. Gerencia porta de login, sessão, tema, acento por
 * pessoa, tour guiado e a Judite sempre montada.
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
  const [hidden, setHidden] = useState(false);
  const [tourReplay, setTourReplay] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!hasParam) setMonth(month);
  }, [hasParam, month, setMonth]);

  useEffect(() => {
    const p = prefs.preferences ?? defaultPreferences;
    if (p.theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = p.theme;

    const preset = resolveAccentPreset(p.accent);
    document.documentElement.dataset.accent = preset.id;

    try {
      localStorage.setItem("entre-nos-theme-v1", p.theme);
      localStorage.setItem("entre-nos-accent-v1", preset.id);
    } catch {}

    // Limpa eventuais variáveis inline deixadas por versões antigas.
    document.documentElement.style.removeProperty("--family-accent");
    document.documentElement.style.removeProperty("--family-on-accent");
  }, [prefs.preferences]);

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
      headerSlot: null,
    }),
    [
      user,
      reader,
      prefs.preferences,
      prefs.loaded,
      prefs.updatePreferences,
      hidden,
      reloadAuth,
    ],
  );

  const navItems = APP_ROUTES.flatMap((r) =>
    r.nav ? [{ path: r.path, ...r.nav }] : [],
  );

  return (
    <SessionProvider value={session}>
      <div
        className={`family-app min-h-dvh bg-canvas text-ink lg:flex${pathname === "/judite" ? " is-chat" : ""}`}
      >
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-xl focus:border focus:border-border focus:bg-surface focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-ink focus:shadow-lg"
          href="#family-content"
        >
          Ir para o conteúdo
        </a>

        {/* Sidebar desktop (lg+) */}
        <aside className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:w-60 lg:shrink-0 lg:flex-col lg:border-r lg:border-border lg:bg-surface lg:px-3.5 lg:py-5">
          <div className="mb-6 flex items-center gap-2.5 px-2">
            <BrandMark />
            <div className="min-w-0">
              <span className="block truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
                Entre Nós
              </span>
              <span className="block truncate text-xs text-muted">
                Finanças do casal
              </span>
            </div>
          </div>

          <nav
            data-tour={isDesktop ? "navigation" : undefined}
            aria-label="Áreas da família"
            className="flex flex-col gap-1"
          >
            {navItems.map((item) => {
              const active = pathname === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => go(item.path)}
                  className={`ui-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    active
                      ? "bg-accent-soft font-semibold text-accent-ink"
                      : "font-medium text-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  <span
                    className="inline-flex size-5 shrink-0 items-center justify-center [&>svg]:size-[1.125rem]"
                    aria-hidden="true"
                  >
                    <FamilyIcon name={item.icon} />
                  </span>
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-auto flex flex-col gap-1.5 border-t border-border pt-4">
            <button
              type="button"
              aria-pressed={hidden}
              onClick={() => setHidden(!hidden)}
              className={`ui-nav-item flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                hidden
                  ? "bg-accent-soft font-semibold text-accent-ink"
                  : "font-medium text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              <span
                className="inline-flex size-5 shrink-0 items-center justify-center [&>svg]:size-[1.125rem]"
                aria-hidden="true"
              >
                <FamilyIcon name="eye" />
              </span>
              <span className="truncate">
                {hidden ? "Mostrar valores" : "Ocultar valores"}
              </span>
            </button>

            <button
              type="button"
              data-tour={isDesktop ? "profile" : undefined}
              aria-label="Nosso espaço e configurações"
              aria-current={pathname === "/espaco" ? "page" : undefined}
              onClick={() => go("/espaco")}
              className={`ui-nav-item flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                pathname === "/espaco"
                  ? "bg-accent-soft text-accent-ink"
                  : "text-ink hover:bg-surface-2"
              }`}
            >
              <span className="shrink-0">
                <HeaderAvatar
                  key={user.email + ":" + (prefs.preferences.revision ?? 0)}
                  hasPhoto={prefs.preferences.has_photo ?? false}
                  revision={prefs.preferences.revision ?? 0}
                  name={user.name}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold leading-tight">
                  {user.name}
                </span>
                <span className="block truncate text-xs text-muted leading-tight">
                  Nosso espaço
                </span>
              </span>
            </button>
          </div>
        </aside>

        {/* Coluna principal */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Header compacto mobile (< lg) */}
          <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-border/80 bg-canvas/90 px-4 pt-[calc(0.625rem+env(safe-area-inset-top))] pb-2.5 backdrop-blur-md">
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark />
              <span className="truncate text-sm font-semibold tracking-tight text-ink">
                Entre Nós
              </span>
            </div>
            <h1 className="sr-only">{titleFor(pathname)}</h1>
            <div className="flex items-center gap-1.5">
              <IconButton
                icon="eye"
                label={hidden ? "Mostrar valores" : "Ocultar valores"}
                pressed={hidden}
                onClick={() => setHidden(!hidden)}
              />
              <button
                type="button"
                className="ui-reset-btn inline-flex size-10 items-center justify-center rounded-full p-0.5 transition-transform active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                data-tour={!isDesktop ? "profile" : undefined}
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
            </div>
          </header>

          <main id="family-content" className="family-main flex-1">
            {children}
            <JuditeKeepAlive active={pathname === "/judite"} />
          </main>

          {prefs.loaded && (
            <AppOverview
              key={user.email}
              preferences={prefs.preferences}
              onSaved={prefs.updatePreferences}
              replay={tourReplay}
              onStart={() => {
                if (pathname !== "/") go("/");
              }}
              onClose={() => setTourReplay(false)}
            />
          )}

          {/* Barra inferior mobile (< lg) */}
          <nav
            data-tour={!isDesktop ? "navigation" : undefined}
            className="ui-mobile-nav lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
            aria-label="Áreas da família"
          >
            <div className="mx-auto grid h-16 max-w-lg grid-cols-5 px-1">
              {navItems.map((item) => {
                const active = pathname === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => go(item.path)}
                    className={`ui-nav-item flex flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-1 text-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active ? "text-accent-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`inline-flex h-7 w-12 items-center justify-center rounded-full transition-colors [&>svg]:size-5 ${
                        active ? "bg-accent-soft text-accent-ink" : ""
                      }`}
                    >
                      <FamilyIcon name={item.icon} />
                    </span>
                    <span
                      className={`text-[0.75rem] leading-tight ${
                        active ? "font-semibold" : "font-medium"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
    </SessionProvider>
  );
}
