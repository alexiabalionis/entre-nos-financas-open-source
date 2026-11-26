-- Memória do assistente (SPEC-JUDITE-MEMORIA): conclusões e decisões que a
-- casa confirmou. Da casa, não da persona. Esquecer é arquivar (sem DELETE).
CREATE TABLE IF NOT EXISTS ai_assistant_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES households(id),
  kind text NOT NULL CHECK(kind IN ('diagnostico','combinado','objetivo','aprendizado')),
  text text NOT NULL CHECK(char_length(text) BETWEEN 1 AND 600),
  -- Em que situação a conclusão nasceu: pergunta, período, o que foi olhado.
  context text NOT NULL CHECK(char_length(context) BETWEEN 1 AND 300),
  -- Temas normalizados (sem acento, minúsculos) para o filtro exato.
  topics text[] NOT NULL DEFAULT '{}' CHECK(cardinality(topics) <= 8),
  category_id uuid,
  -- Data de referência da conclusão ou decisão (não é validade).
  as_of date NOT NULL,
  effective_from date,
  effective_until date,
  -- Texto, contexto e temas normalizados pelo servidor; base da busca. O
  -- tsvector sai de texto porque expressão com array não é imutável.
  search_doc text NOT NULL,
  search tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', search_doc)) STORED,
  replaces uuid,
  archived_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(household_id,id),
  FOREIGN KEY(household_id,category_id) REFERENCES categories(household_id,id),
  -- Só substitui memória da mesma casa.
  FOREIGN KEY(household_id,replaces) REFERENCES ai_assistant_memories(household_id,id),
  CHECK(replaces IS NULL OR replaces <> id),
  CHECK(effective_until IS NULL OR effective_from IS NULL OR effective_until >= effective_from)
);

-- Cada memória é substituída no máximo uma vez (barra substituições concorrentes).
CREATE UNIQUE INDEX IF NOT EXISTS ai_assistant_memories_replaces
  ON ai_assistant_memories(replaces) WHERE replaces IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_assistant_memories_active
  ON ai_assistant_memories(household_id,created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS ai_assistant_memories_search
  ON ai_assistant_memories USING gin(search);
CREATE INDEX IF NOT EXISTS ai_assistant_memories_topics
  ON ai_assistant_memories USING gin(topics);

DO $$
BEGIN
  ALTER TABLE ai_assistant_memories ENABLE ROW LEVEL SECURITY;
  ALTER TABLE ai_assistant_memories FORCE ROW LEVEL SECURITY;
  REVOKE ALL ON ai_assistant_memories FROM PUBLIC;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='ai_assistant_memories' AND policyname='family_read') THEN
    CREATE POLICY family_read ON ai_assistant_memories FOR SELECT TO family_app USING(current_member(household_id,false));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='ai_assistant_memories' AND policyname='family_insert') THEN
    CREATE POLICY family_insert ON ai_assistant_memories FOR INSERT TO family_app WITH CHECK(current_member(household_id,true));
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE tablename='ai_assistant_memories' AND policyname='family_update') THEN
    CREATE POLICY family_update ON ai_assistant_memories FOR UPDATE TO family_app USING(current_member(household_id,true)) WITH CHECK(current_member(household_id,true));
  END IF;
  GRANT SELECT,INSERT,UPDATE ON ai_assistant_memories TO family_app;
END $$;
