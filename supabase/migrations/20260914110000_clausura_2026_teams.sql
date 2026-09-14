-- Equipos y jugadores del Interclubes Clausura 2026.
--
-- Generado por scripts/tournament-roster.ts a partir de
-- backfill/interclubes-clausura-2026.csv. Los jugadores se referencian por DNI: es lo que
-- identifica a la misma persona en cualquier base.
--
-- En la base local, antes de importar producción, sólo están los jugadores
-- del seed: la migración carga a los que encuentra y no falla por los
-- demás. Que en producción hayan entrado todos lo confirma
--   scripts/tournament-roster.ts <csv> --verify
-- después del db push.
--
-- Los primeros 12 jugadores de campo de cada lista son titulares, del
-- 13 en adelante suplentes; los arqueros, titulares.

-- Jugadores que estaban cargados sin DNI. Se los identifica por id (el de
-- producción; en local la fila no existe hasta el import y el UPDATE no
-- toca nada) y sólo se escribe donde no había un DNI real.
UPDATE players SET dni = '44996832'
  WHERE id = '9c9f36db-7b39-4899-a410-5ea2d2852ca7' AND (dni IS NULL OR length(dni) < 6)
  AND NOT EXISTS (SELECT 1 FROM players WHERE dni = '44996832'); -- Chevallier, Jose
UPDATE players SET dni = '32266699'
  WHERE id = '1860b51f-b150-4898-9fe5-9d3ef30239df' AND (dni IS NULL OR length(dni) < 6)
  AND NOT EXISTS (SELECT 1 FROM players WHERE dni = '32266699'); -- Vespignani, Malena
UPDATE players SET dni = '43820812'
  WHERE id = 'ffcfdf9a-4438-430a-86c0-77fe5a770ea3' AND (dni IS NULL OR length(dni) < 6)
  AND NOT EXISTS (SELECT 1 FROM players WHERE dni = '43820812'); -- Morgan, Thomas

WITH t AS (
  SELECT id FROM tournaments WHERE name = 'Interclubes Clausura 2026'
), new_teams AS (
  INSERT INTO teams (id, tournament_id, category_id, name)
  SELECT v.id::uuid, t.id, c.id, v.team
  FROM t
  CROSS JOIN (VALUES
    ('7676370c-176a-450d-9cd3-029e71cea463', 'ACEMHH A', 'Elite'),
    ('c4c13bbc-ab2d-44b1-b700-737e652756f0', 'ACEMHH B Linces', 'Master'),
    ('9ebe0666-55d0-4c46-a673-52622e5f1c33', 'ACEMHH B', 'Master'),
    ('f7a1f360-0d7f-45df-9a16-72c75432bb5b', 'ACEMHH C1', 'Senior'),
    ('bbace017-fada-499d-8e64-5c963793b906', 'ACEMHH C2', 'Senior'),
    ('b456cf2f-7907-4785-bfcc-3237be3d826b', 'ACEMHH D', 'Rookies')
  ) AS v(id, team, category)
  JOIN tournament_categories c ON c.tournament_id = t.id AND c.name = v.category
  RETURNING id, name
)
INSERT INTO team_players (team_id, player_id, role)
SELECT nt.id, p.id, m.role
FROM (VALUES
  ('ACEMHH A', '45069171', 'starter'),  -- Savchuk, Roman [A]
  ('ACEMHH A', '40399571', 'starter'),  -- San Millan, Lionel [C]
  ('ACEMHH A', '44093479', 'starter'),  -- Gonzalez, Benjamin
  ('ACEMHH A', '94095210', 'starter'),  -- Clementino, Renzo [A]
  ('ACEMHH A', '52084759', 'starter'),  -- La Greca, Nicolas
  ('ACEMHH A', '38046819', 'starter'),  -- Montes, Lucas
  ('ACEMHH A', '41824605', 'starter'),  -- Del Gesso, Tomas
  ('ACEMHH A', '49553349', 'starter'),  -- Ocampo, Nicolas
  ('ACEMHH A', '757136133', 'starter'),  -- Barvinok, Sergei
  ('ACEMHH A', '44301815', 'starter'),  -- Jimenez, Francisco
  ('ACEMHH A', '657244839', 'starter'),  -- Nazarov, Stanislav [GK]
  ('ACEMHH A', '44996832', 'starter'),  -- Chevallier, Jose [GK]
  ('ACEMHH B Linces', '48242449', 'starter'),  -- Burgess-Webb, Benicio
  ('ACEMHH B Linces', '94177888', 'starter'),  -- Burgess-Webb, Adam [C]
  ('ACEMHH B Linces', '38028404', 'starter'),  -- Casanova, Franco [A]
  ('ACEMHH B Linces', '40258121', 'starter'),  -- Tibaudin, Guido
  ('ACEMHH B Linces', '34142337', 'starter'),  -- Cersosimo, Maximiliano
  ('ACEMHH B Linces', '37406659', 'starter'),  -- Tibaudin, Sacha
  ('ACEMHH B Linces', '39919457', 'starter'),  -- Zorrilla, Nahuel
  ('ACEMHH B Linces', '40394940', 'starter'),  -- Naredo, Luciano
  ('ACEMHH B Linces', '25846735', 'starter'),  -- Barrio, Ariel
  ('ACEMHH B Linces', '46026135', 'starter'),  -- Thompson, Luca
  ('ACEMHH B Linces', '42662568', 'starter'),  -- Tubio, Damian [GK]
  ('ACEMHH B Linces', '50701847', 'starter'),  -- Parodi, Juan Cruz [GK]
  ('ACEMHH B', '45481386', 'starter'),  -- Mamani, Nazareno
  ('ACEMHH B', '41744146', 'starter'),  -- Trinidad, Luciano
  ('ACEMHH B', '42816081', 'starter'),  -- Esposito, Facundo
  ('ACEMHH B', '30887225', 'starter'),  -- De Lio, Alejandro
  ('ACEMHH B', '30706165', 'starter'),  -- Barcia, Sebastian [C]
  ('ACEMHH B', '32386605', 'starter'),  -- Berkovics, Diego [A]
  ('ACEMHH B', '40231173', 'starter'),  -- Fornari, Mariano
  ('ACEMHH B', '49302545', 'starter'),  -- Marquez, Noah
  ('ACEMHH B', '41586780', 'starter'),  -- Suez, Tomás
  ('ACEMHH B', '40785302', 'starter'),  -- Ataniya, Ivan
  ('ACEMHH B', '30592884', 'starter'),  -- Augier, Guadalupe
  ('ACEMHH B', '50701847', 'starter'),  -- Parodi, Juan Cruz [GK]
  ('ACEMHH B', '42662568', 'starter'),  -- Tubio, Damian [GK]
  ('ACEMHH C1', '24017314', 'starter'),  -- Kitaura, Andres
  ('ACEMHH C1', '27537303', 'starter'),  -- Mazzalupo, Adrian
  ('ACEMHH C1', '32760838', 'starter'),  -- Dresco, Javier
  ('ACEMHH C1', '16547880', 'starter'),  -- Di Gangi, Daniel
  ('ACEMHH C1', '25714849', 'starter'),  -- Sanchez, Héctor [A]
  ('ACEMHH C1', '93781527', 'starter'),  -- Romero, Antón [A]
  ('ACEMHH C1', '38891110', 'starter'),  -- Loste, Ayrton
  ('ACEMHH C1', '38684105', 'starter'),  -- Piaggio, Santiago [C]
  ('ACEMHH C1', '41663698', 'starter'),  -- Diaz, Didier
  ('ACEMHH C1', '36133210', 'starter'),  -- Amitrano, Nicolás
  ('ACEMHH C1', '19016950', 'starter'),  -- Cachique, Jesus
  ('ACEMHH C1', '23668702', 'starter'),  -- Pizzolitto, Daniel
  ('ACEMHH C1', '32266699', 'substitute'),  -- Vespignani, Malena
  ('ACEMHH C1', '95976742', 'starter'),  -- Zambrano, Humberto [GK]
  ('ACEMHH C1', '51072209', 'starter'),  -- Navarro, Lisandro [GK]
  ('ACEMHH C2', '40730440', 'starter'),  -- Castro, Abril [C]
  ('ACEMHH C2', '47346491', 'starter'),  -- Carrascosa, Joaquin
  ('ACEMHH C2', '49548796', 'starter'),  -- Mazza, Facundo
  ('ACEMHH C2', '50706090', 'starter'),  -- Burgess-Webb, Milo
  ('ACEMHH C2', '29478232', 'starter'),  -- Detto, Romina [A]
  ('ACEMHH C2', '18852229', 'starter'),  -- Berezyuk, Ruslan [A]
  ('ACEMHH C2', '46988013', 'starter'),  -- Vlasyk, David
  ('ACEMHH C2', '30556751', 'starter'),  -- Blanco, Ezequiel
  ('ACEMHH C2', '50513205', 'starter'),  -- Rios, Marcus
  ('ACEMHH C2', '51397291', 'starter'),  -- Rosa, Francisco
  ('ACEMHH C2', '37979296', 'starter'),  -- Coronel, Raul
  ('ACEMHH C2', '42340704', 'starter'),  -- Rebollar, Nathan
  ('ACEMHH C2', '47481406', 'substitute'),  -- Altamura, Manuela
  ('ACEMHH C2', '37932210', 'substitute'),  -- Tedone, Mariano
  ('ACEMHH C2', '31104315', 'substitute'),  -- Nievas, Agostina
  ('ACEMHH C2', '92709937', 'starter'),  -- Pons Bessio, Edwar Frank [GK]
  ('ACEMHH C2', '51072209', 'starter'),  -- Navarro, Lisandro [GK]
  ('ACEMHH D', '43820812', 'starter'),  -- Morgan, Thomas
  ('ACEMHH D', '46556581', 'starter'),  -- Barrios, Thiago
  ('ACEMHH D', '26844127', 'starter'),  -- Avila, Alejandro
  ('ACEMHH D', '30579209', 'starter'),  -- Romero, Alejandro
  ('ACEMHH D', '96007532', 'starter'),  -- Figueroa, Rafael
  ('ACEMHH D', '35216075', 'starter'),  -- Libonatto, Martín
  ('ACEMHH D', '95985130', 'starter'),  -- Mendoza, Iswaldo
  ('ACEMHH D', '39322353', 'starter'),  -- Montalbo, Tomás [A]
  ('ACEMHH D', '49419108', 'starter'),  -- Rodriguez, Victoria
  ('ACEMHH D', '48025775', 'starter'),  -- Rodriguez, Ariadna [C]
  ('ACEMHH D', '37840240', 'starter'),  -- Da Luz, Lucas [A]
  ('ACEMHH D', '19113731', 'starter'),  -- Idarraga, Mário
  ('ACEMHH D', '49759180', 'substitute'),  -- De Campos, Franco
  ('ACEMHH D', '70848207', 'substitute'),  -- Cedeño, Rafael
  ('ACEMHH D', '39656065', 'starter')  -- Bragán, Feli [GK]
) AS m(team, dni, role)
JOIN new_teams nt ON nt.name = m.team
JOIN players p ON p.dni = m.dni;

-- Los 6 equipos tienen que existir aunque falten jugadores.
DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM teams tm
  JOIN tournaments t ON t.id = tm.tournament_id AND t.name = 'Interclubes Clausura 2026';
  IF n <> 6 THEN
    RAISE EXCEPTION 'Se esperaban 6 equipos y hay %', n;
  END IF;
  SELECT count(*) INTO n FROM team_players tp
  JOIN teams tm ON tm.id = tp.team_id
  JOIN tournaments t ON t.id = tm.tournament_id AND t.name = 'Interclubes Clausura 2026';
  RAISE NOTICE 'Interclubes Clausura 2026: % de 84 jugadores cargados en sus equipos', n;
END $$;
