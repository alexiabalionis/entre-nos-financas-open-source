-- Objetivos (caixinhas), plano de reserva por mês e movimentos de reserva. Já
-- preparado para vários objetivos por família. Nada é apagado: corrigir um
-- plano é substituí-lo (superseded_by) e corrigir um movimento é cancelá-lo
-- (voided_*), para o histórico do que a família decidiu continuar legível.
-- Escrito para rodar duas vezes sem erro (IF NOT EXISTS e policies só quando
-- ainda não existem). Sem UPDATE de dados existentes. Mesmo padrão de RLS das
-- migrations 013/022/023.

CREATE TABLE IF NOT EXISTS goals (
 id uuid PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES households(id),
 name text NOT NULL CHECK(char_length(name) BETWEEN 1 AND 80),
 target_cents bigint NOT NULL CHECK(target_cents>0),
 deadline_month date CHECK(deadline_month IS NULL OR extract(day FROM deadline_month)=1),
 priority smallint NOT NULL DEFAULT 1 CHECK(priority BETWEEN 1 AND 99),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','done','archived')),
 -- null = ainda não perguntado onde o dinheiro da reserva fica.
 location text CHECK(location IS NULL OR location IN ('same_account','elsewhere')),
 version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(household_id,id),
 FOREIGN KEY(household_id,created_by) REFERENCES members(household_id,user_id)
);

-- planned_cents = 0 é a decisão explícita de não guardar neste mês.
CREATE TABLE IF NOT EXISTS reserve_plans (
 id uuid PRIMARY KEY,
 household_id uuid NOT NULL,
 goal_id uuid NOT NULL,
 month date NOT NULL CHECK(extract(day FROM month)=1),
 planned_cents bigint NOT NULL CHECK(planned_cents>=0),
 plan_date date NOT NULL,
 occurrence_id uuid REFERENCES income_occurrences(id),
 -- Adiada até o commit: o plano antigo aponta para o novo antes de ele existir.
 superseded_by uuid REFERENCES reserve_plans(id) DEFERRABLE INITIALLY DEFERRED,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(household_id,id),
 FOREIGN KEY(household_id,goal_id) REFERENCES goals(household_id,id),
 FOREIGN KEY(household_id,created_by) REFERENCES members(household_id,user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS reserve_plans_current ON reserve_plans(household_id,goal_id,month) WHERE superseded_by IS NULL;

CREATE TABLE IF NOT EXISTS reserve_movements (
 id uuid PRIMARY KEY,
 household_id uuid NOT NULL,
 goal_id uuid NOT NULL,
 plan_id uuid,
 kind text NOT NULL CHECK(kind IN ('deposit','withdrawal')),
 cents bigint NOT NULL CHECK(cents>0),
 date date NOT NULL,
 bank_transaction_id uuid,
 voided_at timestamptz,
 voided_by uuid,
 void_reason text,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(household_id,id),
 CHECK((voided_at IS NULL)=(void_reason IS NULL)),
 FOREIGN KEY(household_id,goal_id) REFERENCES goals(household_id,id),
 FOREIGN KEY(household_id,plan_id) REFERENCES reserve_plans(household_id,id),
 FOREIGN KEY(household_id,bank_transaction_id) REFERENCES bank_transactions(household_id,id),
 FOREIGN KEY(household_id,created_by) REFERENCES members(household_id,user_id),
 FOREIGN KEY(household_id,voided_by) REFERENCES members(household_id,user_id)
);
-- Uma linha do banco nunca vale para dois movimentos ativos.
CREATE UNIQUE INDEX IF NOT EXISTS reserve_movements_bank ON reserve_movements(household_id,bank_transaction_id) WHERE bank_transaction_id IS NOT NULL AND voided_at IS NULL;
CREATE INDEX IF NOT EXISTS reserve_movements_goal ON reserve_movements(household_id,goal_id);

-- Gasto semanal declarado quando falta histórico para estimar o dia a dia.
ALTER TABLE household_finance_settings ADD COLUMN IF NOT EXISTS everyday_weekly_cents bigint CHECK(everyday_weekly_cents IS NULL OR everyday_weekly_cents>=0);

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['goals','reserve_plans','reserve_movements'] LOOP
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
