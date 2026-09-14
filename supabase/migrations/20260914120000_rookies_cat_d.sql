-- La categoría D existe como categoría de entrenamiento, y los jugadores del
-- equipo ACEMHH D (Rookies) del Clausura 2026 pasan a ella.
--
-- Reemplaza cat-c por cat-d y conserva youth: el que era cat-c queda cat-d, el
-- que era youth queda youth y cat-d, y el que tenía las dos queda youth y
-- cat-d. El orden de las categorías no importa para esto.
--
-- Corre después de la migración de equipos, que es la que carga los DNIs que
-- faltaban.
UPDATE players
SET categories = CASE
  WHEN 'cat-d' = ANY (categories) THEN array_remove(categories, 'cat-c')
  ELSE array_append(array_remove(categories, 'cat-c'), 'cat-d')
END
WHERE dni IN ('43820812', '46556581', '26844127', '30579209', '96007532', '35216075', '95985130', '39322353', '49419108', '48025775', '37840240', '19113731', '49759180', '70848207', '39656065');

-- El horario de las 23hs admite también a la categoría D. Se modifica la
-- configuración vigente desde el principio y no se abre una nueva: así los que
-- eran cat-c siguen figurando en las sesiones pasadas de las 23hs a las que
-- fueron. Las categorías del slot deciden quién aparece en la lista, no qué
-- se cobra.
UPDATE training_slot_features
SET categories = array_append(categories, 'cat-d')
WHERE weekday = 4 AND hour = 23 AND NOT ('cat-d' = ANY (categories));

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM players WHERE 'cat-d' = ANY (categories);
  RAISE NOTICE 'Jugadores con cat-d: %', n;
  SELECT count(*) INTO n FROM training_slot_features WHERE 'cat-d' = ANY (categories);
  IF n = 0 THEN
    RAISE EXCEPTION 'Ningún horario admite cat-d';
  END IF;
END $$;
