-- Fase 1 de docs/SPEC-JUDITE-PROFUNDIDADE.md: o rodapé da resposta diz de qual
-- modelo ela veio. Nulo em resposta local e em resposta externa antiga.
ALTER TABLE chat_turns ADD COLUMN IF NOT EXISTS model text CHECK (model IS NULL OR length(model) <= 80);
