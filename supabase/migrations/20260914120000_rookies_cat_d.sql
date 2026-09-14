-- Los jugadores del equipo ACEMHH D (Rookies) del Clausura 2026 pasan a tener
-- también la categoría cat-d.
--
-- Se AGREGA, no se reemplaza: la categoría decide en qué entrenamiento aparece
-- el jugador (training_slot_features) y ningún slot tiene cat-d. Reemplazar
-- los sacaba de la lista de asistencia del jueves — tres de ellos entrenan a
-- las 23hs como cat-c y tres a las 21hs como youth, y la de youth además rige
-- su sesión bonificada. La primera categoría sigue siendo la principal.
--
-- Corre después de la migración de equipos, que es la que le carga el DNI a
-- Morgan.
UPDATE players
SET categories = array_append(categories, 'cat-d')
WHERE dni IN ('43820812', '46556581', '26844127', '30579209', '96007532', '35216075', '95985130', '39322353', '49419108', '48025775', '37840240', '19113731', '49759180', '70848207', '39656065')
  AND NOT ('cat-d' = ANY (categories));

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM players WHERE 'cat-d' = ANY (categories);
  RAISE NOTICE 'Jugadores con cat-d: %', n;
END $$;
