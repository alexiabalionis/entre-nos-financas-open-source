"use client";
import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import { Icon } from "./icon.tsx";
import { cx } from "./shared.ts";

export type TopicHubTone = "neutral" | "accent" | "ok" | "warn" | "danger";

export type TopicHubItem<TId extends string> = {
  id: TId;
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  tone?: TopicHubTone;
};

export type TopicHubProps<TId extends string> = {
  items: readonly TopicHubItem<TId>[];
  selected: TId | null;
  onSelect: (id: TId | null) => void;
  promptTitle?: ReactNode;
  promptSubtitle?: ReactNode;
  aside?: ReactNode;
  backLabel?: string;
  showQuickSwitch?: boolean;
  columns?: 1 | 2 | 3;
  renderContent: (id: TId) => ReactNode;
  className?: string;
};

const iconToneClass: Record<TopicHubTone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent-ink",
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
};

const gridColsClass: Record<1 | 2 | 3, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
};

/**
 * Seletor inicial de tópicos ("hub -> visualização focada"): permite escolher
 * um recorte antes de abrir gráficos e tabelas, com navegação de volta e troca rápida.
 */
export function TopicHub<TId extends string>({
  items,
  selected,
  onSelect,
  promptTitle,
  promptSubtitle,
  aside,
  backLabel = "Voltar",
  showQuickSwitch = true,
  columns,
  renderContent,
  className,
}: TopicHubProps<TId>) {
  const resolvedColumns: 1 | 2 | 3 =
    columns ?? (items.length === 3 ? 3 : items.length === 1 ? 1 : 2);
  const activeItem =
    selected !== null ? (items.find((item) => item.id === selected) ?? null) : null;

  if (!activeItem) {
    return (
      <div className={cx("flex min-w-0 flex-col gap-5", className)}>
        {(promptTitle != null || promptSubtitle != null || aside != null) && (
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            {(promptTitle != null || promptSubtitle != null) && (
              <div className="space-y-1">
                {promptTitle != null ? (
                  <h2 className="m-0 text-base font-semibold tracking-tight text-ink">
                    {promptTitle}
                  </h2>
                ) : null}
                {promptSubtitle != null ? (
                  <div className="text-sm leading-relaxed text-muted">
                    {promptSubtitle}
                  </div>
                ) : null}
              </div>
            )}
            {aside != null ? <div className="ml-auto shrink-0">{aside}</div> : null}
          </div>
        )}

        <div className={cx("grid gap-4", gridColsClass[resolvedColumns])}>
          {items.map((item) => {
            const tone = item.tone ?? "neutral";
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className="ui-reset-btn group flex min-w-0 cursor-pointer flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-5 text-left transition-colors hover:border-border-strong hover:bg-surface-2/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex w-full min-w-0 flex-col gap-3">
                  <span className="flex w-full items-center justify-between gap-3">
                    {item.icon != null ? (
                      <span
                        aria-hidden="true"
                        className={cx(
                          "inline-flex size-10 shrink-0 items-center justify-center rounded-xl",
                          iconToneClass[tone],
                        )}
                      >
                        {item.icon}
                      </span>
                    ) : (
                      <span />
                    )}
                    <span
                      aria-hidden="true"
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink"
                    >
                      <Icon name="right" size={16} />
                    </span>
                  </span>

                  <span className="flex min-w-0 flex-col gap-1">
                    {item.eyebrow != null ? (
                      <span className="text-xs font-medium uppercase tracking-wide text-muted">
                        {item.eyebrow}
                      </span>
                    ) : null}
                    <span className="text-[1rem] font-semibold leading-snug tracking-tight text-ink">
                      {item.title}
                    </span>
                    {item.description != null ? (
                      <span className="text-xs leading-relaxed text-muted">
                        {item.description}
                      </span>
                    ) : null}
                  </span>
                </span>

                {item.meta != null ? (
                  <span className="w-full border-t border-border/70 pt-3 font-numeric text-xs font-medium tabular-nums text-ink-2">
                    {item.meta}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const activeTone = activeItem.tone ?? "neutral";

  return (
    <div className={cx("flex min-w-0 flex-col gap-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Button
          variant="quiet"
          size="sm"
          icon="left"
          onClick={() => onSelect(null)}
        >
          {backLabel}
        </Button>

        {showQuickSwitch && items.length > 1 ? (
          <div
            role="group"
            aria-label="Trocar de assunto"
            className="hidden flex-wrap items-center gap-1.5 sm:flex"
          >
            {items.map((item) => {
              const active = item.id === activeItem.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(item.id)}
                  className={cx(
                    "ui-reset-btn inline-flex min-h-8 cursor-pointer items-center rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                    active
                      ? "border-accent/25 bg-accent-soft font-semibold text-accent-ink"
                      : "border-border bg-surface font-medium text-muted hover:bg-surface-2 hover:text-ink",
                  )}
                >
                  {item.title}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div className="flex items-start gap-3 border-b border-border pb-3.5">
        {activeItem.icon != null ? (
          <span
            aria-hidden="true"
            className={cx(
              "mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl",
              iconToneClass[activeTone],
            )}
          >
            {activeItem.icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 space-y-0.5">
          <h2 className="m-0 text-base font-semibold leading-snug tracking-tight text-ink">
            {activeItem.title}
          </h2>
          {activeItem.description != null ? (
            <div className="text-xs leading-relaxed text-muted">
              {activeItem.description}
            </div>
          ) : null}
        </div>
        {aside != null ? <div className="shrink-0 self-center">{aside}</div> : null}
      </div>

      <div key={activeItem.id} className="ds-stagger flex min-w-0 flex-col gap-5">
        {renderContent(activeItem.id)}
      </div>
    </div>
  );
}
