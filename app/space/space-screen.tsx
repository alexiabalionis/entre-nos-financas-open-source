"use client";
import { Collapsible } from "../collapsible";
import { Panel } from "../ds/panel";
import { RowList } from "../ds/row-list";
import { BackToTop } from "../ds/back-to-top.tsx";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ProfileCard } from "../profile-card";
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

/**
 * Nosso espaço: perfil, casal, bancos, contas fixas, avisos, privacidade e
 * instalação. Abre o cartão pedido em `?painel=`; o
 * link antigo com #family-banks também abre os bancos.
 */
export function SpaceScreen() {
  const session = useSession();
  const { user } = session;
  const router = useRouter();
  const params = useSearchParams();
  const period = usePeriodData();
  const action = useAction();
  const { members, reload: reloadMembers } = useMembers(true);
  const [profilePanel, setProfilePanel] = useState<string | null>(
    () => params.get("painel"),
  );
  const toggleProfile = (panel: string) =>
    setProfilePanel((current) => (current === panel ? null : panel));
  useEffect(() => {
    if (BANK_HASHES.includes(location.hash)) setProfilePanel("banks");
  }, []);
  const { work, busy } = action;
  const data = period.ready ? period.data : null;
  return (
    <>
      <ActionBanner error={action.error || period.error} notice={action.notice} />
      <div className="profile-cards grid min-w-0 gap-3">
            {session.preferencesLoaded && (
              <ProfileCard
                title="Meu perfil"
                description="Foto, cores e aparência do app"
                expanded={profilePanel === "appearance"}
                onToggle={() => toggleProfile("appearance")}
              >
                <PreferencesPanel
                  key={user.email}
                  preferences={session.preferences}
                  onSaved={session.updatePreferences}
                  name={user.name}
                  onTour={session.replayTour}
                  onEditHome={() => {
                    router.push(
                      withMonth("/", period.month, { editar: "1" }),
                      { scroll: false },
                    );
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                />
              </ProfileCard>
            )}
            <ProfileCard
              title="Nosso casal"
              description="Quem compartilha este espaço com você"
              expanded={profilePanel === "couple"}
              onToggle={() => toggleProfile("couple")}
            >
              <Panel title="Um espaço para vocês dois">
                <RowList rows={members.map((m) => ({ title: m.name, sub: m.email }))} />
                {user.role === "owner" && members.length === 1 && (
                  <Collapsible summary="Adicionar minha esposa">
                    <form
                      onSubmit={(e) => {
                        const v = formValues(e);
                        void work(async () => {
                          await api("members", { ...v, role: "editor" });
                          await reloadMembers();
                        }, "Acesso individual criado.");
                      }}
                    >
                      <label>
                        Nome
                        <input
                          name="name"
                          autoComplete="name"
                          required
                          maxLength={120}
                        />
                      </label>
                      <label>
                        E-mail
                        <input
                          name="email"
                          type="email"
                          autoComplete="email"
                          required
                        />
                      </label>
                      <label>
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
                      <button className="btn btn-primary" disabled={busy}>Criar acesso dela</button>
                    </form>
                  </Collapsible>
                )}
              </Panel>
            </ProfileCard>
            {user.administrator && (
              <ProfileCard
                title="Administrar famílias"
                description="Adicionar e consultar os casais convidados"
                expanded={profilePanel === "administration"}
                onToggle={() => toggleProfile("administration")}
              >
                <FamilyAdministration />
              </ProfileCard>
            )}
            <ProfileCard
              title="Contas e cartões"
              description="Conectar contas e ler movimentos"
              expanded={profilePanel === "banks"}
              onToggle={() => toggleProfile("banks")}
            >
              {data ? (
                <BankPanel
                  accounts={data.state.accounts}
                  reader={session.reader}
                  hidden={session.hidden}
                  refresh={period.reload}
                />
              ) : (
                <PeriodLoading error={period.error} onRetry={period.reload} />
              )}
            </ProfileCard>
            <ProfileCard
              title="Contas fixas"
              description="O que se repete todo mês, em um lugar só"
              expanded={profilePanel === "fixed"}
              onToggle={() => toggleProfile("fixed")}
            >
              <FixedOverviewCard
                open={profilePanel === "fixed"}
                month={period.month}
                data={data}
                reloadPeriod={period.reload}
              />
            </ProfileCard>
            <ProfileCard
              title="Categorias e etiquetas"
              description="Organize os gastos do casal"
              expanded={profilePanel === "categories"}
              onToggle={() => toggleProfile("categories")}
            >
              {data ? (
                <CategoriesPanel
                  categories={data.state.categories}
                  reader={session.reader}
                  refresh={period.reload}
                />
              ) : (
                <PeriodLoading error={period.error} onRetry={period.reload} />
              )}
            </ProfileCard>
            <ProfileCard
              title="Notificações"
              description="Lembretes e avisos nos seus aparelhos"
              expanded={profilePanel === "notifications"}
              onToggle={() => toggleProfile("notifications")}
            >
              <NotificationsPanel />
            </ProfileCard>
            <ProfileCard
              title="Privacidade e acesso"
              description="Proteção dos dados, senha e sair da conta"
              expanded={profilePanel === "privacy"}
              onToggle={() => toggleProfile("privacy")}
            >
              <Panel title="Privacidade">
                <p className="text-sm">
                  Os documentos originais continuam no computador. Os registros
                  financeiros e as conversas ficam no banco privado. Cada acesso
                  vê apenas o próprio histórico de chat.
                </p>
                <p className="ds-caption text-xs opacity-60">
                  Marcar um compromisso como pago atualiza a lista do mês. Isso
                  não duplica um pagamento que já está no histórico.
                </p>
                <Collapsible summary="Alterar minha senha">
                  <form
                    onSubmit={(e) => {
                      const v = formValues(e);
                      void work(async () => {
                        await api("auth/password", v);
                      }, "Senha atualizada; outros acessos foram encerrados.");
                    }}
                  >
                    <label>
                      Senha atual
                      <input
                        name="current"
                        type="password"
                        autoComplete="current-password"
                        required
                      />
                    </label>
                    <label>
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
                    <button className="btn btn-primary" disabled={busy}>Salvar nova senha</button>
                  </form>
                </Collapsible>
                <button
                  className="btn btn-outline btn-error"
                  disabled={busy}
                  onClick={() =>
                    void work(async () => {
                      await session.signOut();
                    }, "")
                  }
                >
                  Sair do nosso espaço
                </button>
              </Panel>
            </ProfileCard>
            <ProfileCard
              title="Instalar o app"
              description="Adicionar o Entre Nós ao seu aparelho"
              expanded={profilePanel === "install"}
              onToggle={() => toggleProfile("install")}
            >
              <InstallApp />
            </ProfileCard>
      </div>
      <BackToTop />
    </>
  );
}
