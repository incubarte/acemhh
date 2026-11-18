-- Los partidos registrados antes de que el egreso nombrara al equipo: a cada
-- uno su equipo, sacado de las notas (aclaradas a mano donde no alcanzaban).
-- Los que sumaban varios partidos o equipos se parten en uno por partido y
-- por equipo; la parte nueva copia quién pagó, cómo y cuándo. Después la
-- regla vale para todas las filas.
--
-- Los ids son de producción: en una base sin esas filas no hace nada.

-- Las dos partes nuevas de cada egreso partido, antes de achicar el original.
INSERT INTO expenses (amount, concept, paid_by, is_cash, notes, created_at, team_id)
SELECT v.amount, 'partidos', e.paid_by, e.is_cash, e.notes, e.created_at, v.team::uuid
FROM (VALUES
  -- ACEMHH B vs Linces: 520k
  ('a2361cff-5d13-4e02-8e54-d05092e84ec8', 260000, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  -- Pago C2 y C1 torneo 20/9: 430k (la mesa de C2, 90k, la pagó Coco aparte)
  ('206cf8d1-b86a-4a9e-91d4-91fce967296f', 170000, 'ce14d510-b81c-4b4a-b841-8e3453e55177'),
  -- 23/09 B vs ovejas y C2 vs Hazard white: 520k
  ('bddeb4ae-ca2f-4016-9262-3679ccc431e7', 260000, 'ce14d510-b81c-4b4a-b841-8e3453e55177'),
  -- Pago x 2 partidos 12/10 y 29/10 ACEMHH C1: dos pistas, 350k
  ('1d9b7306-2987-4503-b98c-e7f549ce2a4e', 175000, '877af798-ac30-499f-8912-2790eddc7a96'),
  -- Mesa de partidos 14 oct, B vs Winter y C2 vs CHHL: 170k
  ('a948d4ab-6f5b-4f7e-9300-c5408db19c62', 85000, 'ce14d510-b81c-4b4a-b841-8e3453e55177'),
  -- Se paga C1 y D (pista + mesa): 520k
  ('cad06e6c-2f77-4057-8033-883bad3d91f1', 260000, 'a819a1aa-3c6b-4e55-af52-67865214790e')
) AS v(id, amount, team)
JOIN expenses e ON e.id = v.id::uuid AND e.concept = 'partidos' AND e.team_id IS NULL;

-- Cada egreso viejo con su equipo; los partidos, con lo que les queda.
UPDATE expenses e
SET team_id = v.team::uuid,
    amount = COALESCE(v.amount, e.amount)
FROM (VALUES
  -- ACEMHH A
  ('2e1d79f7-c2f0-4c16-8a78-0f7018d908c9', NULL, '550ecc8e-0684-4c36-8bc1-61cc87528d1a'),
  ('7310094f-0c42-4f77-b8b8-2bb12c6c433f', NULL, '550ecc8e-0684-4c36-8bc1-61cc87528d1a'),
  ('767475aa-b2a0-48fa-a28c-e9a453baab31', NULL, '550ecc8e-0684-4c36-8bc1-61cc87528d1a'),
  ('f96a3777-62db-4cf9-b8af-6fa3cd1167b1', NULL, '550ecc8e-0684-4c36-8bc1-61cc87528d1a'),
  ('3d4fe6ae-a86f-4dd6-baa3-e45209b71eca', NULL, '550ecc8e-0684-4c36-8bc1-61cc87528d1a'),
  ('35a50954-898c-4f51-88dc-c739c55d58c8', NULL, '550ecc8e-0684-4c36-8bc1-61cc87528d1a'),
  -- ACEMHH B
  ('a2361cff-5d13-4e02-8e54-d05092e84ec8', 260000, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('4781d14c-72d8-4dd8-a5bc-28374c720315', NULL, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('6776e55d-3139-4d3d-9677-6af04207cafe', NULL, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('bddeb4ae-ca2f-4016-9262-3679ccc431e7', 260000, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('728d7b3f-a86b-4e9f-b549-a49af21feecf', NULL, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('a948d4ab-6f5b-4f7e-9300-c5408db19c62', 85000, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('dda94110-979f-4aef-a960-e1a8114b719c', NULL, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  ('2edcb0e0-c512-460c-8c7d-144673b3b2d5', NULL, 'a7c56b35-6caa-4edb-ba61-0ad320c2bd70'),
  -- ACEMHH B Linces
  ('b3f637df-8a99-4e20-b77a-0112f9bd8b95', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('b0c654ba-2d91-4c4a-add3-2a4796f34091', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('58f57bb7-06d2-42bc-9247-bbf9d8fdd65a', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('3bcf7f48-5605-43fd-834e-277c1caab454', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('709c9180-319c-474d-b0d0-8244c23b80c3', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('9cd758e6-1649-4404-aa7b-9071bc856d7f', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('6620ffcc-1059-422f-ad84-f3273dc9f407', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  ('2e537593-e1ed-4411-b12d-93716b3bff70', NULL, 'f3be9f9f-b7e3-4a30-8246-1dbce85817cd'),
  -- ACEMHH C1
  ('ca9355e5-630b-4c8e-b00d-487c93050071', NULL, '877af798-ac30-499f-8912-2790eddc7a96'),
  ('206cf8d1-b86a-4a9e-91d4-91fce967296f', 260000, '877af798-ac30-499f-8912-2790eddc7a96'),
  ('a793c47d-a082-4c1d-a8e8-abaeaf7e2c53', NULL, '877af798-ac30-499f-8912-2790eddc7a96'),
  ('1d9b7306-2987-4503-b98c-e7f549ce2a4e', 175000, '877af798-ac30-499f-8912-2790eddc7a96'),
  ('a1443df2-5d1b-492f-b2dc-02f0db9a3eb7', NULL, '877af798-ac30-499f-8912-2790eddc7a96'),
  ('cad06e6c-2f77-4057-8033-883bad3d91f1', 260000, '877af798-ac30-499f-8912-2790eddc7a96'),
  -- ACEMHH C2
  ('5418ab1b-4b3a-4ee7-af38-8af903d31aca', NULL, 'ce14d510-b81c-4b4a-b841-8e3453e55177'),
  ('13b93c4b-72e9-4c53-80c1-1a03a40b4167', NULL, 'ce14d510-b81c-4b4a-b841-8e3453e55177'),
  ('a9b78bfe-61cb-4c28-9f86-afa337ea71e0', NULL, 'ce14d510-b81c-4b4a-b841-8e3453e55177'),
  -- ACEMHH D
  ('065d6a0a-b175-45f0-b979-5bf35fc6a7b7', NULL, 'a819a1aa-3c6b-4e55-af52-67865214790e'),
  ('5da56b1a-cbe4-4c58-ac32-1e2ce89d9623', NULL, 'a819a1aa-3c6b-4e55-af52-67865214790e'),
  ('9150931b-2a71-40f8-8179-fd28b2b750b1', NULL, 'a819a1aa-3c6b-4e55-af52-67865214790e')
) AS v(id, amount, team)
WHERE e.id = v.id::uuid AND e.concept = 'partidos' AND e.team_id IS NULL;

-- La pista del partido de C2 del 2/11 se cargó como hora de pista; la mesa
-- del mismo partido sí como partido.
UPDATE expenses
SET concept = 'partidos', team_id = 'ce14d510-b81c-4b4a-b841-8e3453e55177'
WHERE id = '5ac1fda9-2d3d-4fd6-a3cf-c3b98c9bcc69' AND concept = 'hora de pista';

-- Si quedó un partido sin equipo (uno cargado mientras tanto, o un id que
-- no matcheó), mejor que la migración falle y se mire a mano.
ALTER TABLE expenses VALIDATE CONSTRAINT expenses_team_by_concept;
