-- "Agora não" das sugestões do Futuro: vale para a casa toda (os dois
-- parceiros enxergam a mesma lista). metric_cents guarda o número que
-- motivou a sugestão, para ela poder reaparecer se o quadro mudar muito.
CREATE TABLE IF NOT EXISTS dismissed_suggestions (
  household_id uuid NOT NULL REFERENCES households(id),
  suggestion_id text NOT NULL CHECK(length(suggestion_id) BETWEEN 1 AND 200),
  metric_cents bigint,
  dismissed_by uuid REFERENCES users(id),
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(household_id,suggestion_id)
);

DO $$
BEGIN
  ALTER TABLE dismissed_suggestions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE dismissed_suggestions FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON dismissed_suggestions FROM PUBLIC;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='dismissed_suggestions' AND policyname='family_read') THEN
    CREATE POLICY family_read ON dismissed_suggestions FOR SELECT TO family_app USING(current_member(household_id,false));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='dismissed_suggestions' AND policyname='family_insert') THEN
    CREATE POLICY family_insert ON dismissed_suggestions FOR INSERT TO family_app WITH CHECK(current_member(household_id,true));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='dismissed_suggestions' AND policyname='family_update') THEN
    CREATE POLICY family_update ON dismissed_suggestions FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='dismissed_suggestions' AND policyname='family_delete') THEN
    CREATE POLICY family_delete ON dismissed_suggestions FOR DELETE TO family_app USING(current_member(household_id,true));
  END IF;
  GRANT SELECT,INSERT,UPDATE,DELETE ON dismissed_suggestions TO family_app;
END $$;
