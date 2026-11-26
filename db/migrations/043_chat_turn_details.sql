-- Fase 3a de docs/SPEC-JUDITE-PROFUNDIDADE.md: o detalhe numérico da resposta
-- ("Ver as contas"). Nulo em resposta antiga e quando a resposta não trouxe contas.
ALTER TABLE chat_turns ADD COLUMN IF NOT EXISTS details text CHECK (details IS NULL OR length(details) <= 2000);
