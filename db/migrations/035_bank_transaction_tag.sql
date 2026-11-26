-- Etiqueta escolhida para um movimento do banco ainda pendente. A categoria do
-- movimento vem das regras (merchant_rules), então a coerência etiqueta x
-- categoria é checada ao gravar e ao ler; aqui só o vínculo. Excluir a etiqueta
-- solta o vínculo.
ALTER TABLE bank_transactions ADD COLUMN IF NOT EXISTS tag_id uuid;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bank_transactions_tag_fk'
  ) THEN
    ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_tag_fk
      FOREIGN KEY(tag_id) REFERENCES category_tags(id) ON DELETE SET NULL;
  END IF;
END $$;
