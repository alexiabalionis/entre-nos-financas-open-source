"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Collapsible } from "../collapsible";
import { Button } from "../ds/button";
import { Icon } from "../ds/icon";
import { Panel } from "../ds/panel";
import { RowList } from "../ds/row-list";
import { BackToTop } from "../ds/back-to-top.tsx";
import { PreferencesPanel } from "../family-personalization";
import { FamilyAdministration } from "../family-administration";
import { BankPanel } from "../family-banks";
import { FixedOverviewCard } from "../fixed/overview/fixed-overview-card";
import { NotificationsPanel } from "../family-notifications";
import { CategoriesPanel } from "./categories/categories-panel";
import { InstallApp } from "../mobile";
import { ActionBanner } from "../shell/action-banner";
import { PeriodLoading } from "../shell/period-loading";
import { withMonth } from "../shell/routes.ts";
import { useSession } from "../session/session-context";
import { useAction } from "../hooks/use-action.ts";
import { useMembers } from "../hooks/use-members.ts";
import { usePeriodData } from "../hooks/use-period-data.ts";
import { api } from "../lib/api.ts";
import { formValues } from "../lib/form.ts";

const BANK_HASHES = ["#family-banks", "#bank-onboarding"];

type SectionId =
  | "appearance"
  | "couple"
  | "administration"
  | "banks"
  | "fixed"
  | "categories"
  | "notifications"
  | "privacy"
  | "install";

type SectionDef = {
  id: SectionId;
  title: string;
  description: string;
};

type SectionGroup = {
  label: string;
  items: SectionDef[];
};

function normalizeSection(raw: string | null, isAdmin: boolean): SectionId | null {
  if (!raw) return null;
  if (raw === "bancos") return "banks";
  const valid: SectionId[] = [
    "appearance",
    "couple",
    "banks",
    "fixed",
    "categories",
    "notifications",
    "privacy",
    "install",
    ...(isAdmin ? (["administration"] as const) : []),
  ];
  return valid.includes(raw as SectionId) ? (raw as SectionId) : null;
}

/**
 * Nosso espaço: configurações organizadas por seções (navegação lateral no
 * desktop, índice limpo com drill-down no mobile).
 */
export function SpaceScreen() {
  const session = useSession();
  const { user } = session;
  const router = useRouter();
  const params = useSearchParams();
  const period = usePeriodData();
  const action = useAction();
  const { members, reload: reloadMembers } = useMembers(true);

  const groups: SectionGroup[] = useMemo(
    () => [
      {
        label: "Conta e casal",
        items: [
          {
            id: "appearance",
            title: "Meu perfil",
            description: "Foto, cores e aparência do app",
          },
          {
            id: "couple",
            title: "Nosso casal",
            description: "Quem compartilha este espaço com você",
          },
          ...(user.administrator
            ? [
                {
                  id: "administration" as const,
                  title: "Administrar famílias",
                  description: "Adicionar e consultar os casais convidados",
                },
              ]
            : []),
        ],
      },
      {
        label: "Finanças",
        items: [
          {
            id: "banks",
            title: "Contas e cartões",
            description: "Conectar contas e ler movimentos",
          },
          {
            id: "fixed",
            title: "Contas fixas",
            description: "O que se repete todo mês, em um lugar só",
          },
          {
            id: "categories",
            title: "Categorias e etiquetas",
            description: "Organize os gastos do casal",
          },
        ],
      },
      {
        label: "App e segurança",
        items: [
          {
            id: "notifications",
            title: "Notificações",
            description: "Lembretes e avisos nos seus aparelhos",
          },
          {
            id: "privacy",
            title: "Privacidade e acesso",
            description: "Proteção dos dados, senha e sair da conta",
          },
          {
            id: "install",
            title: "Instalar o app",
            description: "Adicionar o Entre Nós ao seu aparelho",
          },
        ],
      },
    ],
    [user.administrator],
  );

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const [selected, setSelected] = useState<SectionId | null>(() =>
    normalizeSection(params.get("painel"), !!user.administrator),
  );

  useEffect(() => {
    const fromParam = normalizeSection(params.get("painel"), !!user.administrator);
    if (fromParam) {
      setSelected(fromParam);
      return;
    }
    if (typeof window !== "undefined" && BANK_HASHES.includes(window.location.hash)) {
      setSelected("banks");
      return;
    }
    setSelected(null);
  }, [params, user.administrator]);

  const selectSection = useCallback(
    (id: SectionId | null) => {
      setSelected(id);
      const url = id
        ? withMonth("/espaco", period.month, { painel: id })
        : withMonth("/espaco", period.month);
      router.replace(url, { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [period.month, router],
  );

  // No desktop, sempre exibe uma seção ativa (padrão: Meu perfil).
  const activeDesktop: SectionId = selected ?? "appearance";
  const activeMobile: SectionId | null = selected;
  const activeDef =
    allItems.find((i) => i.id === activeDesktop) ?? allItems[0];

  const { work, busy } = action;
  const data = period.ready ? period.data : null;

  const renderSectionContent = (sectionId: SectionId) => {
    switch (sectionId) {
      case "appearance":
        return session.preferencesLoaded ? (
          <PreferencesPanel
            key={user.email}
            preferences={session.preferences}
            onSaved={session.updatePreferences}
            name={user.name}
            onTour={session.replayTour}
          />
        ) : null;
      case "couple":
        return (
          <Panel title="Um espaço para vocês dois" className="mb-0">
            <RowList rows={members.map((m) => ({ title: m.name, sub: m.email }))} />
            {user.role === "owner" && members.length === 1 && (
              <Collapsible summary="Adicionar outra pessoa do casal">
                <form
                  className="flex flex-col gap-3 pt-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = formValues(e);
                    void work(async () => {
                      await api("members", { ...v, role: "editor" });
                      await reloadMembers();
                    }, "Acesso individual criado.");
                  }}
                >
                  <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                    Nome
                    <input
                      name="name"
                      autoComplete="name"
                      required
                      maxLength={120}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                    E-mail
                    <input
                      name="email"
                      type="email"
                      autoComplete="email"
                      required
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                    Senha inicial
                    <input
                      name="password"
                      type="password"
                      minLength={12}
                      maxLength={128}
                      autoComplete="new-password"
                      required
                    />
                  </label>
                  <div>
                    <Button type="submit" variant="primary" disabled={busy}>
                      Criar acesso
                    </Button>
                  </div>
                </form>
              </Collapsible>
            )}
          </Panel>
        );
      case "administration":
        return user.administrator ? <FamilyAdministration /> : null;
      case "banks":
        return data ? (
          <BankPanel
            accounts={data.state.accounts}
            reader={session.reader}
            hidden={session.hidden}
            refresh={period.reload}
          />
        ) : (
          <PeriodLoading error={period.error} onRetry={period.reload} />
        );
      case "fixed":
        return (
          <FixedOverviewCard
            open
            month={period.month}
            data={data}
            reloadPeriod={period.reload}
          />
        );
      case "categories":
        return data ? (
          <CategoriesPanel
            categories={data.state.categories}
            reader={session.reader}
            refresh={period.reload}
          />
        ) : (
          <PeriodLoading error={period.error} onRetry={period.reload} />
        );
      case "notifications":
        return <NotificationsPanel />;
      case "privacy":
        return (
          <Panel title="Privacidade e acesso" className="mb-0">
            <p className="m-0 text-sm leading-relaxed text-ink">
              Os documentos originais continuam no computador. Os registros
              financeiros e as conversas ficam no banco privado. Cada acesso
              vê apenas o próprio histórico de chat.
            </p>
            <Collapsible summary="Alterar minha senha">
              <form
                className="flex flex-col gap-3 pt-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = formValues(e);
                  void work(async () => {
                    await api("auth/password", v);
                  }, "Senha atualizada; outros acessos foram encerrados.");
                }}
              >
                <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                  Senha atual
                  <input
                    name="current"
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
                  Nova senha
                  <input
                    name="password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                  />
                </label>
                <div>
                  <Button type="submit" variant="primary" disabled={busy}>
                    Salvar nova senha
                  </Button>
                </div>
              </form>
            </Collapsible>
            <div className="border-t border-border pt-3">
              <Button
                variant="secondary"
                className="!border-danger/35 !text-danger hover:!bg-danger-bg"
                disabled={busy}
                onClick={() =>
                  void work(async () => {
                    await session.signOut();
                  }, "")
                }
              >
                Sair do nosso espaço
              </Button>
            </div>
          </Panel>
        );
      case "install":
        return <InstallApp />;
    }
  };

  return (
    <>
      <ActionBanner error={action.error || period.error} notice={action.notice} />

      <div className="mb-5">
        <h1 className="m-0 text-xl font-semibold tracking-tight text-ink sm:text-2xl">
          Nosso espaço
        </h1>
        <p className="m-0 mt-1 text-sm text-muted">
          Preferências pessoais, conexões bancárias e ajustes da família.
        </p>
      </div>

      {/* Desktop: navegação lateral por seções + painel ativo */}
      <div className="hidden md:flex md:items-start md:gap-7">
        <nav
          aria-label="Seções de Nosso espaço"
          className="sticky top-6 flex w-56 shrink-0 flex-col gap-5"
        >
          {groups.map((group) => (
            <div key={group.label} className="flex flex-col gap-1">
              <p className="m-0 px-3 pb-1 text-[0.6875rem] font-semibold uppercase tracking-wider text-muted">
                {group.label}
              </p>
              {group.items.map((item) => {
                const active = activeDesktop === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => selectSection(item.id)}
                    className={`ui-nav-item flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      active
                        ? "bg-accent-soft font-semibold text-accent-ink"
                        : "font-medium text-muted hover:bg-surface-2 hover:text-ink"
                    }`}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 flex flex-col gap-4">
          <div className="border-b border-border pb-3">
            <h2 className="m-0 text-base font-semibold text-ink">
              {activeDef.title}
            </h2>
            <p className="m-0 mt-0.5 text-xs text-muted">
              {activeDef.description}
            </p>
          </div>
          {renderSectionContent(activeDesktop)}
        </div>
      </div>

      {/* Mobile: índice agrupado limpo -> drill-down na seção */}
      <div className="md:hidden">
        {!activeMobile ? (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.label} className="flex flex-col gap-2">
                <h2 className="m-0 px-1 text-xs font-semibold uppercase tracking-wider text-muted">
                  {group.label}
                </h2>
                <div className="overflow-hidden rounded-2xl border border-border bg-surface divide-y divide-border">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => selectSection(item.id)}
                      className="ui-row-btn flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2/60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block text-sm font-semibold text-ink">
                          {item.title}
                        </strong>
                        <small className="block text-xs text-muted">
                          {item.description}
                        </small>
                      </span>
                      <Icon name="right" size={16} className="shrink-0 text-muted" />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <Button
                variant="quiet"
                size="sm"
                icon="left"
                onClick={() => selectSection(null)}
              >
                Nosso espaço
              </Button>
              <span className="truncate text-sm font-semibold text-ink">
                {allItems.find((i) => i.id === activeMobile)?.title}
              </span>
            </div>
            {renderSectionContent(activeMobile)}
          </div>
        )}
      </div>

      <BackToTop />
    </>
  );
}
