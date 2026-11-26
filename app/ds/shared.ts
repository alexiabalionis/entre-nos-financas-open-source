/**
 * Design system · helpers compartilhados pelos primitivos.
 * Sem domínio financeiro, sem hex cru. O tom semântico é um enum neutro que
 * resolve as cores via [data-tone] no CSS (family.css). DRY: todo primitivo
 * que tem "tom" usa este tipo e esta função; ninguém redefine as cores.
 */
import type { ReactNode } from "react";

/** Tom semântico neutro. Mapeado para --tone / --tone-bg em family.css. */
export type Tone = "ok" | "warn" | "danger" | "accent" | "neutral";

/** Tamanho padrão de átomos quadrados (badges, etc.). */
export type Size = "sm" | "md" | "lg";

/** Junta classes, descartando falsy. Mesma convenção do button.tsx. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Props de tom reusáveis por qualquer primitivo tonal. */
export type Toned = { tone?: Tone };

/** data-tone só quando há tom explícito (neutral é o default do CSS). */
export function toneAttr(tone?: Tone): { "data-tone"?: Tone } {
  return tone ? { "data-tone": tone } : {};
}

/** Classes completas (o Tailwind só gera classes escritas por extenso). */
export const badgeTone: Record<Tone, string> = {
  ok: "badge-success",
  warn: "badge-warning",
  danger: "badge-error",
  accent: "badge-accent",
  neutral: "",
};
/** Badge sólido: neutral cai em badge-neutral. */
export const solidTone: Record<Tone, string> = { ...badgeTone, neutral: "badge-neutral" };
export const alertTone: Record<Tone, string> = {
  ok: "alert-success",
  warn: "alert-warning",
  danger: "alert-error",
  // daisyUI não tem alert-accent; destaque informativo usa info.
  accent: "alert-info",
  neutral: "",
};

export type { ReactNode };
