-- Marca uma categoria como de custo FIXO: quando ligada, toda despesa dessa
-- categoria é tratada como "Custos fixos" na tela de Mês, sem o usuário
-- classificar item por item. Default false (as categorias nascem variáveis e
-- a sugestão automática por nome/categoria continua valendo para quem não
-- marcar). A categoria já tem GRANT UPDATE + policy update_family (migration
-- 001), então não é preciso nada além da coluna.
ALTER TABLE categories ADD COLUMN fixed boolean NOT NULL DEFAULT false;
