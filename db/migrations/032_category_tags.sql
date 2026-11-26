-- Etiqueta = subcategoria leve, só rótulo: totais, tetos e gráficos continuam
-- lendo category_id. A FK composta em economic_events impede etiqueta de outra
-- categoria; tag_id nulo não é checado (MATCH SIMPLE).
CREATE TABLE IF NOT EXISTS category_tags (
  id uuid PRIMARY KEY,
  household_id uuid NOT NULL REFERENCES households(id),
  category_id uuid NOT NULL,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 120),
  UNIQUE(household_id,category_id,id),
  FOREIGN KEY(household_id,category_id) REFERENCES categories(household_id,id)
);

CREATE UNIQUE INDEX IF NOT EXISTS category_tags_name_unique ON category_tags(household_id,category_id,lower(btrim(name)));

ALTER TABLE economic_events ADD COLUMN IF NOT EXISTS tag_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'economic_events_category_tag_fk'
  ) THEN
    ALTER TABLE economic_events ADD CONSTRAINT economic_events_category_tag_fk
      FOREIGN KEY(household_id,category_id,tag_id) REFERENCES category_tags(household_id,category_id,id);
  END IF;
END $$;

DO $$
BEGIN
  ALTER TABLE category_tags ENABLE ROW LEVEL SECURITY;
  ALTER TABLE category_tags FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON category_tags FROM PUBLIC;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='category_tags' AND policyname='family_read') THEN
    CREATE POLICY family_read ON category_tags FOR SELECT TO family_app USING(current_member(household_id,false));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='category_tags' AND policyname='family_insert') THEN
    CREATE POLICY family_insert ON category_tags FOR INSERT TO family_app WITH CHECK(current_member(household_id,true));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='category_tags' AND policyname='family_update') THEN
    CREATE POLICY family_update ON category_tags FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='category_tags' AND policyname='family_delete') THEN
    CREATE POLICY family_delete ON category_tags FOR DELETE TO family_app USING(current_member(household_id,true));
  END IF;
  GRANT SELECT,INSERT,UPDATE,DELETE ON category_tags TO family_app;
END $$;
