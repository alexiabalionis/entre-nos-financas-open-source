"use client";
import { api } from "../lib/api.ts";
import { formValues } from "../lib/form.ts";
import { useAction } from "../hooks/use-action.ts";
import { ActionBanner } from "./action-banner";
import type { AuthStatus } from "../hooks/use-auth.ts";

/** Tela enquanto o status da sessão ainda não chegou. */
export function OpeningScreen({ error }: { error: string }) {
  return (
    <main className="family-login">
      <span className="family-logo" aria-hidden="true">
        <img src="/icons/icon-192-v3.png" width="64" height="64" alt="" />
      </span>
      <h1>Abrindo nosso espaço…</h1>
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
    <main className="family-login">
      <span className="family-logo" aria-hidden="true">
        <img src="/icons/icon-192-v3.png" width="64" height="64" alt="" />
      </span>
      <p className="eyebrow">ENTRE NÓS</p>
      <h1>
        O mês fica mais leve
        <br />
        quando é nosso.
      </h1>
      <p>Um lugar para as contas, os planos e a vida de vocês.</p>
      <form
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
            <label>
              Seu nome
              <input name="name" autoComplete="given-name" required />
            </label>
            <input type="hidden" name="familyName" value="Nossa família" />
            {auth.hosted && (
              <label>
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
        <label>
          E-mail
          <input
            name="email"
            type="email"
            autoComplete="username"
            spellCheck={false}
            required
          />
        </label>
        <label>
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
        <button className="primary btn btn-primary" disabled={busy}>
          {busy ? "Entrando…" : "Entrar no nosso espaço"}
        </button>
      </form>
      <ActionBanner error={error} notice={notice} />
      <p className="fine">Acesso privado de vocês dois.</p>
    </main>
  );
}
