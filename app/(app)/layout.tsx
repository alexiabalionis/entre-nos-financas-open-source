import { Suspense, type ReactNode } from "react";
import { connection } from "next/server";
import { AppShell } from "../shell/app-shell";

/**
 * Casca de todas as páginas do app. `connection()` torna a rota dinâmica: o
 * nonce do CSP (proxy.ts) só existe em renderização por requisição.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  await connection();
  return (
    <Suspense fallback={null}>
      <AppShell>{children}</AppShell>
    </Suspense>
  );
}
