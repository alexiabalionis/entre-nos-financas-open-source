"use client";
import { IconBadge } from "./icon-badge";
import type { ReactNode, Tone, Toned } from "./shared";
import { cx, toneAttr } from "./shared";

type CalloutProps = Toned & {
  /** Glifo/ícone da marca. */
  icon: ReactNode;
  title: ReactNode;
  /** Linha de apoio entre o título e o corpo. */
  meta?: ReactNode;
  /** Corpo do aviso. */
  children?: ReactNode;
  /** Bloco <details> opcional no rodapé. */
  details?: ReactNode;
};

const calloutSurface: Record<Tone, string> = {
  ok: "bg-ok-bg/70 border-ok/25 text-ink",
  warn: "bg-warn-bg/75 border-warn/30 text-ink",
  danger: "bg-danger-bg/75 border-danger/25 text-ink",
  accent: "bg-accent-soft/75 border-accent/25 text-ink",
  neutral: "bg-surface-2/80 border-border text-ink",
};

/**
 * Superfície tonal com marca.
 */
export function Callout({
  icon,
  title,
  meta,
  tone = "neutral",
  children,
  details,
}: CalloutProps) {
  return (
    <section
      className={cx(
        "ds-callout flex items-start gap-3 rounded-xl border px-4 py-3.5 text-sm",
        calloutSurface[tone],
      )}
      {...toneAttr(tone)}
    >
      <IconBadge icon={icon} tone={tone} solid className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <h3 className="m-0 text-sm font-semibold leading-snug text-ink">{title}</h3>
        {meta ? (
          <div className="ds-callout-meta m-0 text-xs font-medium text-muted">{meta}</div>
        ) : null}
        {children ? (
          <div className="m-0 text-[0.8125rem] leading-relaxed text-muted">{children}</div>
        ) : null}
        {details}
      </div>
    </section>
  );
}
