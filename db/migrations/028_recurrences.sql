-- Núcleo de recorrências (docs/SPEC-RECORRENCIAS.md, seção 2). Só CREATE TABLE
-- e policies: não altera nenhuma tabela nem linha existente, e nenhum
-- consumidor passa a ler estas tabelas nesta migration.
CREATE TABLE IF NOT EXISTS recurrences (
 id uuid PRIMARY KEY,
 household_id uuid NOT NULL REFERENCES households(id),
 purpose text NOT NULL CHECK(purpose IN ('expense','income')),
 label text NOT NULL CHECK(length(label) BETWEEN 1 AND 180),
 category_id uuid,
 account_id uuid,
 expected_cents bigint NOT NULL CHECK(expected_cents>0),
 frequency text NOT NULL CHECK(frequency IN ('day','week','month','year')),
 every integer NOT NULL DEFAULT 1 CHECK(every BETWEEN 1 AND 366),
 start_date date NOT NULL,
 end_date date CHECK(end_date IS NULL OR end_date>=start_date-1),
 paused boolean NOT NULL DEFAULT false,
 date_rule text NOT NULL DEFAULT 'exact' CHECK(date_rule IN ('exact','weekend_to_friday','fifth_business_day')),
 planning_offset smallint NOT NULL DEFAULT 0 CHECK(planning_offset IN (0,1)),
 match_text text,
 source_event_id uuid,
 replaces_id uuid,
 created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(household_id,id),
 CHECK(purpose<>'expense' OR (category_id IS NOT NULL AND planning_offset=0)),
 FOREIGN KEY(household_id,category_id) REFERENCES categories(household_id,id),
 FOREIGN KEY(household_id,account_id) REFERENCES accounts(household_id,id),
 FOREIGN KEY(household_id,source_event_id) REFERENCES economic_events(household_id,id),
 FOREIGN KEY(household_id,replaces_id) REFERENCES recurrences(household_id,id),
 FOREIGN KEY(household_id,created_by) REFERENCES members(household_id,user_id)
);

CREATE TABLE IF NOT EXISTS recurrence_occurrences (
 id uuid PRIMARY KEY,
 household_id uuid NOT NULL,
 recurrence_id uuid NOT NULL,
 occurrence_date date NOT NULL,
 expected_date date NOT NULL,
 monthly_item_id uuid NOT NULL,
 match_bank_transaction_id uuid,
 match_state text NOT NULL DEFAULT 'planned' CHECK(match_state IN ('planned','detected','review')),
 match_note text NOT NULL DEFAULT '',
 UNIQUE(recurrence_id,occurrence_date),
 UNIQUE(household_id,monthly_item_id),
 UNIQUE(household_id,id),
 FOREIGN KEY(household_id,recurrence_id) REFERENCES recurrences(household_id,id),
 FOREIGN KEY(household_id,monthly_item_id) REFERENCES monthly_items(household_id,id),
 FOREIGN KEY(household_id,match_bank_transaction_id) REFERENCES bank_transactions(household_id,id)
);

CREATE INDEX IF NOT EXISTS recurrences_household ON recurrences(household_id);
CREATE INDEX IF NOT EXISTS recurrence_occurrences_bank ON recurrence_occurrences(household_id,match_bank_transaction_id) WHERE match_bank_transaction_id IS NOT NULL;

DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['recurrences','recurrence_occurrences'] LOOP
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
