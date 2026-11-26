-- F1a do Copiloto: perímetro de dados do Raio-X do futuro. Só ADD COLUMN /
-- CREATE TABLE / policies: nenhum UPDATE, não altera nenhuma linha existente.
-- Escrito para rodar duas vezes sem erro: ADD COLUMN IF NOT EXISTS, CREATE
-- TABLE IF NOT EXISTS e policies criadas só quando ainda não existem. Segue o
-- padrão de RLS das migrations 013/022 (ENABLE+FORCE, current_member,
-- GRANT a family_app).

-- Quais contas entram no saldo conservador (sConf) do Copiloto. A coluna é a
-- DECISÃO EXPLÍCITA do usuário: null = seguir o padrão (conta corrente em BRL
-- entra), true/false = incluir/excluir à mão. Por ser null-sem-default, uma
-- conta criada DEPOIS desta migration também segue o padrão automaticamente
-- (não nasce fora do caixa por acidente). A regra efetiva mora num só lugar
-- (INCLUDED_IN_CASH_SQL em projection-reads.ts), nunca aqui. balance_confirmed_*
-- guarda um saldo informado à mão (quando não há banco conectado nem abertura).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS include_in_cash boolean;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_confirmed_cents bigint;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS balance_confirmed_at date;
-- Sem UPDATE: o padrão (conta corrente BRL incluída) é a própria regra efetiva
-- aplicada na leitura via coalesce. A migration não altera nenhuma linha.

-- Configuração financeira da família para o Copiloto: colchão (cushion) que o
-- motor subtrai da capacidade, e a declaração de "não tenho renda" (desliga a
-- lacuna de renda em aberto da confiança). Uma linha por household.
CREATE TABLE IF NOT EXISTS household_finance_settings (
 household_id uuid PRIMARY KEY REFERENCES households(id),
 cushion_cents bigint NOT NULL DEFAULT 0 CHECK(cushion_cents>=0),
 no_income_declared boolean NOT NULL DEFAULT false,
 updated_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(household_id,updated_by) REFERENCES members(household_id,user_id)
);

-- Decisão do usuário sobre uma recorrência detectada (F0c): confirmar que ela
-- volta todo mês ou descartá-la. scope = id do cartão ou 'cash'; merchant_key =
-- lojista normalizado. A chave composta espelha o decisionKey do motor
-- (projection-recurrences): scope|merchant.
CREATE TABLE IF NOT EXISTS recurrence_decisions (
 household_id uuid NOT NULL REFERENCES households(id),
 scope text NOT NULL,
 merchant_key text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('confirm','dismiss')),
 decided_by uuid NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(household_id,scope,merchant_key),
 FOREIGN KEY(household_id,decided_by) REFERENCES members(household_id,user_id)
);

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['household_finance_settings','recurrence_decisions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC',t);
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_read') THEN
   EXECUTE format('CREATE POLICY family_read ON %I FOR SELECT TO family_app USING(current_member(household_id,false))',t);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_insert') THEN
   EXECUTE format('CREATE POLICY family_insert ON %I FOR INSERT TO family_app WITH CHECK(current_member(household_id,true))',t);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_update') THEN
   EXECUTE format('CREATE POLICY family_update ON %I FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true))',t);
  END IF;
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO family_app',t);
 END LOOP;
END $$;
