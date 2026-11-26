-- Fase 2a de docs/SPEC-JUDITE-PROFUNDIDADE.md: apelido por destinatário ou
-- estabelecimento ("Faxina" para um Pix, "Feira da Josefa" para "PAG*JOSEFA 12").
-- A chave sai da descrição do banco e vale para todos os lançamentos com ela.
-- merchant_key(text) repete src/domain/merchant-key.ts: minúsculas, sem acento,
-- sem as palavras de Pix/TED/transferência, sem números.
CREATE OR REPLACE FUNCTION merchant_key(description text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          translate(
            lower(translate(description, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN')),
            'áàâãäéèêëíìîïóòôõöúùûüçñ',
            'aaaaaeeeeiiiiooooouuuucn'
          ),
          '\y(pix|ted|doc|transf\w*|enviad[oa]|recebid[oa]|para|cpf|cnpj)\y', ' ', 'g'
        ),
        '[0-9.*/-]+', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    ),
    E' \t\r\n'
  )
$$;

CREATE TABLE IF NOT EXISTS merchant_aliases (
  household_id uuid NOT NULL REFERENCES households(id),
  key text NOT NULL CHECK(length(key) BETWEEN 1 AND 200),
  alias text NOT NULL CHECK(length(btrim(alias)) BETWEEN 1 AND 60),
  created_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(household_id,key)
);

DO $$
DECLARE t text := 'merchant_aliases';
BEGIN
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
END $$;
