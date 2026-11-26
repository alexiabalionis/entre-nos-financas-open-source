-- Hora da transação como o banco informou (com fuso). Opcional: NULL para o que
-- veio antes e para lançamento manual. Metadado de leitura; transaction_date
-- segue sendo a data oficial do movimento.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS transaction_at timestamptz;
