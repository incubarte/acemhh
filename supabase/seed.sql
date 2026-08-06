-- Seed user for local development (matches DEV_AUTH_ID in .env.local)
INSERT INTO users (id, username, first_name, last_name)
VALUES
    (45669763, 'Migralito', 'Alejandro', null),
    (40541227, 'DiegoBerko', 'Diego', 'Berko'),
    (6885365547, null, 'Fran', null)
ON CONFLICT (id) DO NOTHING;

-- Phone backfill for local development.
-- Regenerate with:
--   deno run --allow-read --allow-env --allow-net scripts/backfill-phones.ts \
--     <csv> <csv> <csv> --seed
-- Keyed by DNI because seeded players get fresh UUIDs on every db reset.
UPDATE players SET phone = '5491167127993' WHERE dni = '30706165'; -- Sebastian Barcia
UPDATE players SET phone = '5491135036568' WHERE dni = '757136133'; -- Sergei Barvinok
UPDATE players SET phone = '5491140438769' WHERE dni = '18852229'; -- Ruslan Berezyuk
UPDATE players SET phone = '5491154798800' WHERE dni = '32386605'; -- Diego Berkovics
UPDATE players SET phone = '5491151406742' WHERE dni = '30556751'; -- Ezequiel Blanco
UPDATE players SET phone = '5491165760102', guardian_phone = '5491139502556' WHERE dni = '94177888'; -- Adam Burgess-Webb
UPDATE players SET phone = '5491131743718', guardian_phone = '5491139502556' WHERE dni = '48242449'; -- Benicio Burgess-Webb
UPDATE players SET phone = '5491165071912', guardian_phone = '5491139502556' WHERE dni = '50706090'; -- Milo Burgess-Webb
UPDATE players SET phone = '5492246512061' WHERE dni = '47346491'; -- Joaquin Carrascosa
UPDATE players SET phone = '5491156326385' WHERE dni = '38028404'; -- Franco Casanova
UPDATE players SET phone = '5491162602240' WHERE dni = '40730440'; -- Abril Castro
UPDATE players SET phone = '5491134305511' WHERE dni = '94095210'; -- Renzo Clementino
UPDATE players SET phone = '5491154854383' WHERE dni = '30887225'; -- Alejandro De Lio
UPDATE players SET phone = '5491132037282' WHERE dni = '29478232'; -- Romina Detto
UPDATE players SET phone = '5491164271282', guardian_phone = '5491141762622' WHERE dni = '38625068'; -- Daniel Di Leone
UPDATE players SET phone = '5491161445522', guardian_phone = '5491126573933' WHERE dni = '16547880'; -- Daniel Digangi
UPDATE players SET phone = '5491160219391' WHERE dni = '32760838'; -- Javier Dresco
UPDATE players SET phone = '5491144388831' WHERE dni = '41567115'; -- Michel Eseisa
UPDATE players SET phone = '5491150541324', guardian_phone = '5491156048003' WHERE dni = '42816081'; -- Facundo Esposito
UPDATE players SET phone = '5491141928494', guardian_phone = '5491156570645' WHERE dni = '40231173'; -- Mariano Fornari
UPDATE players SET phone = '5491151751236' WHERE dni = '24017314'; -- Andres Kitaura
UPDATE players SET phone = '5492901649417' WHERE dni = '52084759'; -- Nicolas La Greca
UPDATE players SET phone = '5491121573409', guardian_phone = '5491132320106' WHERE dni = '38891110'; -- Ayrton Loste
UPDATE players SET phone = '5491168462593' WHERE dni = '45481386'; -- Nazareno Mamani
UPDATE players SET phone = '5491162645386', guardian_phone = '5491162163133' WHERE dni = '49302545'; -- Noah Marquez
UPDATE players SET phone = '5491165588136', guardian_phone = '5491157519376' WHERE dni = '49548796'; -- Facundo Mazza
UPDATE players SET phone = '5491136930303', guardian_phone = '5491162000320' WHERE dni = '27537303'; -- Adrian Mazzalupo
UPDATE players SET phone = '5491160195121' WHERE dni = '38046819'; -- Lucas Montes
UPDATE players SET phone = '5491126273474' WHERE dni = '40394940'; -- Luciano Naredo
UPDATE players SET phone = '5493584293257', guardian_phone = '5493875219240' WHERE dni = '31104315'; -- Agostina Nievas
UPDATE players SET phone = '5491166931057' WHERE dni = '38684105'; -- Santiago Piaggio
UPDATE players SET phone = '5491169566314' WHERE dni = '93781527'; -- Anton Romero
UPDATE players SET phone = '5491124664972', guardian_phone = '5491164453449' WHERE dni = '25714849'; -- Hector Sanchez
UPDATE players SET phone = '5491125190309' WHERE dni = '45069171'; -- Roman Savchuk
UPDATE players SET phone = '5491130761300' WHERE dni = '46026135'; -- Luca Thompson
UPDATE players SET phone = '5491130378349' WHERE dni = '41744146'; -- Luciano Trinidad
UPDATE players SET phone = '5491123473570', guardian_phone = '5491132066145' WHERE dni = '46988013'; -- David Vlasyk
UPDATE players SET phone = '5491144132396' WHERE dni = '39919457'; -- Nahuel Zorrilla
