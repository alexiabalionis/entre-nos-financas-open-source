-- Para que serviu o gasto, nas palavras da pessoa ("presente da Valentina",
-- "conserto do carro"). Fica no evento, porque cada compra é um fato. Opcional e
-- ainda sem tela: só reserva o lugar, para a Judite e a revisão usarem depois.
ALTER TABLE economic_events
  ADD COLUMN IF NOT EXISTS purpose_note text
    CHECK (purpose_note IS NULL OR char_length(btrim(purpose_note)) BETWEEN 1 AND 500);
