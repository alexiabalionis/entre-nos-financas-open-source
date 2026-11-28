"use client";
import { useState } from "react";
import { useAsyncAction } from "./use-async-action";
import { Field } from "./field";
import { Collapsible } from "./collapsible";
import { Button } from "./button";
import { Panel } from "./ds/panel";
import { RowList } from "./ds/row-list";
type Family = {
  id: string;
  name: string;
  people: { name: string; email: string }[];
};
async function request(body?: unknown) {
  const r = await fetch("/api/admin/families", {
    method: body ? "POST" : "GET",
    cache: "no-store",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error || "Não foi possível concluir.");
  return result;
}
export function FamilyAdministration() {
  const [families, setFamilies] = useState<Family[] | null>(null),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const { busy, error, notice, run } = useAsyncAction();
  return (
    <div role="region" aria-label="Administração de famílias" className="family-administration">
    <Panel title="Famílias que você administra" className="mb-0">
      <p className="ds-caption">
        Só seu perfil pode liberar novos casais. Cada casal terá seu próprio
        espaço, separado das finanças de vocês. Até 30 pessoas no total.
      </p>
      <div>
        <Button
          busy={busy}
          onClick={() =>
            void run(async () => {
              setFamilies((await request()).families);
            })
          }
        >
          Ver famílias cadastradas
        </Button>
      </div>
      {families?.map((f) => (
        <div key={f.id}>
          <h3 className="m-0 text-sm font-semibold text-ink">{f.name}</h3>
          <RowList rows={f.people.map((p) => ({ title: p.name, sub: p.email }))} />
        </div>
      ))}
      {families?.length === 0 && <p className="ds-caption">Nenhum outro casal cadastrado ainda.</p>}
      <Collapsible summary="Adicionar um casal">
        <form
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              v = new FormData(form);
            void run(
              async () => {
                await request({
                  request_id: requestId,
                  familyName: v.get("familyName"),
                  currentPassword: v.get("currentPassword"),
                  first: {
                    name: v.get("firstName"),
                    email: v.get("firstEmail"),
                    password: v.get("firstPassword"),
                  },
                  second: {
                    name: v.get("secondName"),
                    email: v.get("secondEmail"),
                    password: v.get("secondPassword"),
                  },
                });
                form.reset();
                setRequestId(crypto.randomUUID());
                setFamilies((await request()).families);
              },
              "Casal cadastrado. Cada pessoa já pode entrar com seu e-mail e sua senha. Oriente a trocar a senha inicial no próprio perfil.",
            );
          }}
        >
          <Field label="Nome da família">
            <input name="familyName" required maxLength={120} />
          </Field>
          {(["first", "second"] as const).map((prefix, i) => (
            <fieldset key={prefix}>
              <legend>{i === 0 ? "Primeira pessoa" : "Segunda pessoa"}</legend>
              <Field label="Nome">
                <input
                  name={prefix + "Name"}
                  required
                  maxLength={120}
                  autoComplete="off"
                />
              </Field>
              <Field label="E-mail">
                <input
                  name={prefix + "Email"}
                  type="email"
                  required
                  maxLength={200}
                  autoComplete="off"
                />
              </Field>
              <Field label="Senha inicial">
                <input
                  name={prefix + "Password"}
                  type="password"
                  required
                  minLength={12}
                  maxLength={128}
                  autoComplete="new-password"
                />
              </Field>
            </fieldset>
          ))}
          <Field label="Sua senha para autorizar">
            <input
              name="currentPassword"
              type="password"
              required
              minLength={12}
              maxLength={128}
              autoComplete="current-password"
            />
          </Field>
          <p className="ds-caption">
            Os dois acessos são criados juntos. As senhas não ficam visíveis na
            lista de famílias. Entregue cada acesso à pessoa correspondente por
            um canal privado.
          </p>
          <Button type="submit" busy={busy} busyLabel="Criando acessos…">
            Criar família e liberar os dois acessos
          </Button>
        </form>
      </Collapsible>
      {error && (
        <p
          role="alert"
          className="m-0 rounded-xl border border-danger/25 bg-danger-bg px-4 py-3 text-sm font-medium text-danger"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="m-0 rounded-xl border border-info/25 bg-info-bg px-4 py-3 text-sm font-medium text-ink"
        >
          {notice}
        </p>
      )}
    </Panel>
    </div>
  );
}
