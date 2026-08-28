-- El arquero invitado paga más que el del club.
--
-- Hasta ahora había un solo precio de arquero y valía 25.000, que es el del
-- invitado. El del club paga 20.000, así que la columna que existía pasa a
-- significar lo que su nombre dice —el arquero, a secas— y el invitado tiene
-- la suya.
--
-- Ojo con el valor: goalkeeper_session_price CAMBIA de 25.000 a 20.000. Lo que
-- estaba cargado era el precio del invitado.

ALTER TABLE prices ADD COLUMN goalkeeper_invitee_session_price NUMERIC;
UPDATE prices SET
  goalkeeper_invitee_session_price = goalkeeper_session_price,
  goalkeeper_session_price = 20000;
ALTER TABLE prices ALTER COLUMN goalkeeper_invitee_session_price SET NOT NULL;
ALTER TABLE prices ADD CONSTRAINT prices_goalkeeper_invitee_positive
  CHECK (goalkeeper_invitee_session_price > 0);
