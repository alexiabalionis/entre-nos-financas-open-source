"use client";
import { api } from "../lib/api.ts";
import { formValues } from "../lib/form.ts";
import { useAction } from "../hooks/use-action.ts";
import { Button } from "../ds/button.tsx";
import { ActionBanner } from "./action-banner";
import type { AuthStatus } from "../hooks/use-auth.ts";

/** Tela enquanto o status da sessão ainda não chegou. */
export function OpeningScreen({ error }: { error: string }) {
  return (
    <main className="family-login flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-5 py-10 text-center text-ink">
      <span className="size-16 overflow-hidden rounded-2xl shadow-xs" aria-hidden="true">
        <img src="/icons/icon-192-v3.png" width="64" height="64" alt="" className="size-full object-cover" />
      </span>
      <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
        Abrindo nosso espaço…
      </h1>
      <ActionBanner error={error} notice="" />
    </main>
  );
}

/** Login (ou primeiro acesso, quando o app ainda não foi configurado). */
export function LoginGate({
  auth,
  onDone,
}: {
  auth: AuthStatus;
  onDone: () => Promise<void>;
}) {
  const { busy, error, notice, work } = useAction();
  return (
    <main className="family-login flex min-h-dvh flex-col items-center justify-center bg-canvas px-5 py-10 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-7">
        <div className="flex flex-col gap-2">
          <span className="size-14 overflow-hidden rounded-2xl shadow-xs" aria-hidden="true">
            <img src="/icons/icon-192-v3.png" width="56" height="56" alt="" className="size-full object-cover" />
          </span>
          <p className="m-0 text-xs font-semibold tracking-widest uppercase text-accent-ink">
            ENTRE NÓS
          </p>
          <h1 className="m-0 font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
            O mês fica mais leve
            <br />
            quando é nosso.
          </h1>
          <p className="m-0 text-sm text-muted">
            Um lugar para as contas, os planos e a vida de vocês.
          </p>
        </div>
        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            const v = formValues(e);
            void work(async () => {
              await api(auth.configured ? "auth/login" : "auth/setup", v);
              await onDone();
            }, "");
          }}
        >
          {!auth.configured && (
            <>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                Seu nome
                <input name="name" autoComplete="given-name" required />
              </label>
              <input type="hidden" name="familyName" value="Nossa família" />
              {auth.hosted && (
                <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
                  Código de configuração
                  <input
                    name="setupToken"
                    type="password"
                    autoComplete="off"
                    required
                  />
                </label>
              )}
            </>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            E-mail
            <input
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">
            Senha
            <input
              name="password"
              type="password"
              autoComplete={auth.configured ? "current-password" : "new-password"}
              minLength={12}
              maxLength={128}
              required
            />
          </label>
          <Button
            type="submit"
            variant="primary"
            className="mt-1 w-full"
            busy={busy}
            busyLabel="Entrando…"
          >
            Entrar no nosso espaço
          </Button>
        </form>
        <ActionBanner error={error} notice={notice} />
        <p className="fine m-0 text-center text-xs text-muted">
          Acesso privado de vocês dois.
        </p>
      </div>
    </main>
  );
}
