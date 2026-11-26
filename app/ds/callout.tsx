"use client";
import { IconBadge } from "./icon-badge";
import type { ReactNode, Toned } from "./shared";
import { alertTone, cx, toneAttr } from "./shared";

type CalloutProps = Toned & {
  /** Glifo/ícone da marca (emoji/SVG). */
  icon: ReactNode;
  title: ReactNode;
  /** Linha de apoio entre o título e o corpo. */
  meta?: ReactNode;
  /** Corpo do aviso. */
  children?: ReactNode;
  /** Bloco <details> opcional no rodapé. */
  details?: ReactNode;
};

/**
 * Superfície tonal com marca. Porta do Callout do ds-kit. Reusa o IconBadge
 * (DRY); o tom do badge segue o data-tone do próprio .ds-callout via CSS.
 */
export function Callout({ icon, title, meta, tone, children, details }: CalloutProps) {
  return (
    <section
      className={cx(
        "ds-callout alert alert-soft items-start",
        tone && alertTone[tone],
      )}
      {...toneAttr(tone)}
    >
      <IconBadge icon={icon} tone={tone} solid />
      <div>
        <h3 className="font-semibold">{title}</h3>
        {meta ? <p className="ds-callout-meta text-xs opacity-70">{meta}</p> : null}
        <p>{children}</p>
        {details}
      </div>
    </section>
  );
}
