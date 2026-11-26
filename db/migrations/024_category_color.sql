-- Cor fixa por categoria: índice na paleta --family-cat-1..12 (0..11). Antes a
-- cor saía da posição da categoria na barra (mudava de mês para mês) ou de um
-- hash do nome em 8 cores (Cartões e Moradia colidiam). Guardar o índice deixa
-- a cor estável em todos os meses e telas, sem repetir até a paleta acabar.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS color_index smallint;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_color_index_range'
  ) THEN
    ALTER TABLE categories ADD CONSTRAINT categories_color_index_range
      CHECK (color_index IS NULL OR color_index BETWEEN 0 AND 11);
  END IF;
END $$;

-- Categorias existentes: distribui a paleta em ordem de nome, por família, sem
-- repetir nas 12 primeiras. Só preenche quem ainda não tem cor.
UPDATE categories c
SET color_index = s.idx
FROM (
  SELECT id, ((row_number() OVER (PARTITION BY household_id ORDER BY name)) - 1) % 12 AS idx
  FROM categories
) s
WHERE c.id = s.id AND c.color_index IS NULL;

-- Categoria nova sem cor recebe a cor MENOS usada da família (empate: menor
-- índice). Cobre todos os INSERTs (tela de categorias, aprendizado do banco,
-- cadastro inicial) sem mexer em cada um. Roda como quem insere: o RLS de
-- leitura já restringe a contagem à própria família.
CREATE OR REPLACE FUNCTION assign_category_color() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.color_index IS NULL THEN
    SELECT p.idx INTO NEW.color_index
    FROM generate_series(0, 11) AS p(idx)
    LEFT JOIN categories c
      ON c.household_id = NEW.household_id AND c.color_index = p.idx
    GROUP BY p.idx
    ORDER BY count(c.id), p.idx
    LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS categories_assign_color ON categories;
CREATE TRIGGER categories_assign_color
  BEFORE INSERT ON categories
  FOR EACH ROW EXECUTE FUNCTION assign_category_color();
