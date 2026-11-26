-- Contexto da casa: notas curtas ("por que passou do teto") e categorias
-- protegidas (não entram nos cortes do "como sobrar mais"). Vale para a casa
-- toda, os dois parceiros enxergam o mesmo.
CREATE TABLE IF NOT EXISTS context_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  scope text NOT NULL CHECK(scope IN ('household','category','category_month')),
  category_id uuid,
  month date CHECK(month IS NULL OR extract(day FROM month)=1),
  note text NOT NULL CHECK(char_length(note) BETWEEN 1 AND 500),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(
    (scope='household' AND category_id IS NULL AND month IS NULL)
    OR (scope='category' AND category_id IS NOT NULL AND month IS NULL)
    OR (scope='category_month' AND category_id IS NOT NULL AND month IS NOT NULL)
  ),
  FOREIGN KEY(household_id,category_id) REFERENCES categories(household_id,id)
);

-- Uma nota por (casa, escopo, categoria, mês). Nulos entram como valor fixo
-- para o índice tratá-los como iguais (serve em qualquer versão do Postgres).
CREATE UNIQUE INDEX IF NOT EXISTS context_notes_key ON context_notes(
  household_id,
  scope,
  COALESCE(category_id,'00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(month,'0001-01-01'::date)
);

CREATE TABLE IF NOT EXISTS category_context (
  household_id uuid NOT NULL REFERENCES households(id),
  category_id uuid NOT NULL,
  protected boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(household_id,category_id),
  FOREIGN KEY(household_id,category_id) REFERENCES categories(household_id,id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['context_notes','category_context'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_read') THEN
      EXECUTE format('CREATE POLICY family_read ON %I FOR SELECT TO family_app USING(current_member(household_id,false))', t);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_insert') THEN
      EXECUTE format('CREATE POLICY family_insert ON %I FOR INSERT TO family_app WITH CHECK(current_member(household_id,true))', t);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_update') THEN
      EXECUTE format('CREATE POLICY family_update ON %I FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true))', t);
    END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename=t AND policyname='family_delete') THEN
      EXECUTE format('CREATE POLICY family_delete ON %I FOR DELETE TO family_app USING(current_member(household_id,true))', t);
    END IF;
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO family_app', t);
  END LOOP;
END $$;
