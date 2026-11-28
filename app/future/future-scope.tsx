// SEM "use client": componente sem estado (exceção à convenção da seção 2 da spec).
import type { ReactNode } from "react";

/** Invólucro do Copiloto Futuro: unificado na fonte do sistema (DM Sans + Space Grotesk). */
export function FutureScope({ children }: { children: ReactNode }) {
  return <div className="fut-scope">{children}</div>;
}
