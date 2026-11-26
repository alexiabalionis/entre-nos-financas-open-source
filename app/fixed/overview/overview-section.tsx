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
    <section className="card card-border bg-base-100 shadow-sm">
      <div className="card-body gap-4">
        <div className="flex items-center gap-3">
          <IconBadge
            size="lg"
            solid
            tone="accent"
            icon={<Icon name={icon} size={22} />}
          />
          <div className="min-w-0 flex-1">
            <h3 className="m-0 text-base font-semibold leading-snug">
              {title}
            </h3>
            {subtitle && (
              <p className="m-0 text-sm text-base-content/60">{subtitle}</p>
            )}
          </div>
          {count !== undefined && (
            <span className="badge badge-soft badge-sm rounded-full">
              {count}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </section>
  );
}
