-- Fase 1 de docs/SPEC-FATOS-CARTAO.md. Todo movimento do banco vira evento;
-- cancelar um evento (rejeitado pela pessoa ou sumido do banco) o mantém visível
-- e fora dos cálculos, sem apagar. competence_source guarda de onde veio o
-- vencimento gravado em due_date, com os mesmos valores de CompetenceSource.
-- Colunas anuláveis: nenhum evento existente muda de comportamento.
ALTER TABLE economic_events
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text
    CHECK (cancel_reason IS NULL OR char_length(btrim(cancel_reason)) BETWEEN 1 AND 300),
  ADD COLUMN IF NOT EXISTS competence_source text
    CHECK (competence_source IS NULL OR competence_source IN ('bill','declared','cycle','installment_cycle','unknown'));

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'economic_events_cancel_reason_needs_cancel'
  ) THEN
    ALTER TABLE economic_events ADD CONSTRAINT economic_events_cancel_reason_needs_cancel
      CHECK (cancel_reason IS NULL OR cancelled_at IS NOT NULL);
  END IF;
END $$;
