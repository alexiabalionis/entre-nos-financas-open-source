-- Etapa 3 (home-preferences): a 015 travava card_order em EXATAMENTE 9
-- posições e hidden_cards em NO MÁXIMO 9, hardcoded para o conjunto de
-- blocos daquela época. Com os 4 blocos novos de app/month/blocks/registry.ts
-- (ver src/domain/preferences.ts), savePreferences passa a gravar 13 ids e
-- viola esse CHECK. Esta migration troca o CHECK por um limite de FORMA
-- apenas (é um array jsonb, dentro de uma faixa larga) -- o tamanho exato
-- (bater com homeCards.length) e quais ids são válidos continuam
-- responsabilidade do zod (src/server/preferences.ts) e de
-- normalizeHomeOrder (src/domain/preferences.ts); o banco nunca mais sabe
-- "quantos cards existem hoje".
--
-- Idempotente: o nome gerado pelo Postgres para o CHECK inline da 015 não é
-- previsível, então localizamos pelos CHECKs de user_preferences cuja
-- definição (pg_get_constraintdef) menciona card_order/hidden_cards e
-- removemos todos; em seguida criamos os dois CHECKs nomeados novos só se
-- ainda não existirem. Reexecutar este arquivo (ou rodá-lo contra um banco
-- que já tenha os CHECKs novos) dá no mesmo estado: os novos também citam
-- card_order/hidden_cards na definição, então um segundo run os substitui
-- por eles mesmos.
--
-- Não depende da 025 (sem commit, pode ser WIP de outra sessão) -- só toca
-- user_preferences, criada na 015. Não altera o DEFAULT da coluna nem as
-- linhas existentes: uma linha legada de 9 ids continua válida por este
-- CHECK (1..64) e é expandida em runtime por readPreferences.

DO $$
DECLARE c record;
BEGIN
 FOR c IN
  SELECT conname FROM pg_constraint
  WHERE conrelid = 'user_preferences'::regclass
    AND contype = 'c'
    AND (
      pg_get_constraintdef(oid) LIKE '%card_order%'
      OR pg_get_constraintdef(oid) LIKE '%hidden_cards%'
    )
 LOOP
  EXECUTE format('ALTER TABLE user_preferences DROP CONSTRAINT %I', c.conname);
 END LOOP;
END $$;

DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid = 'user_preferences'::regclass
     AND conname = 'user_preferences_card_order_shape'
 ) THEN
  ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_card_order_shape
   CHECK (jsonb_typeof(card_order) = 'array' AND jsonb_array_length(card_order) BETWEEN 1 AND 64);
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid = 'user_preferences'::regclass
     AND conname = 'user_preferences_hidden_cards_shape'
 ) THEN
  ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_hidden_cards_shape
   CHECK (jsonb_typeof(hidden_cards) = 'array' AND jsonb_array_length(hidden_cards) <= jsonb_array_length(card_order));
 END IF;
END $$;
