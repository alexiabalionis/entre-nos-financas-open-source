"use client";
import type { ReactNode } from "react";
import { Icon, type IconName } from "../../ds/icon";
import { IconBadge } from "../../ds/icon-badge";

/**
 * Cartão de seção das contas fixas, no mesmo desenho dos cartões de conexão
 * bancária: ícone, título, subtítulo e a quantidade à direita.
 */
export function OverviewSection({
  icon,
  title,
  subtitle,
  count,
  children,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        <IconBadge
          size="lg"
          solid
          tone="accent"
          icon={<Icon name={icon} size={20} />}
        />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-base font-semibold leading-snug text-ink">
            {title}
          </h3>
          {subtitle && <p className="m-0 text-xs text-muted">{subtitle}</p>}
        </div>
        {count !== undefined && (
          <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-surface-2 px-2 py-0.5 font-numeric text-xs font-semibold tabular-nums text-muted">
            {count}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </section>
  );
}
