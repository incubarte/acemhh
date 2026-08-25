-- "Medio mes": para el que arranca el período con el mes empezado.
--
-- El parcial mensual es un anticipo — otorga el mes entero y deja el resto
-- como obligación — y eso le cobraba el mes completo a alguien que sólo
-- entrenó las sesiones que quedaban. Este concepto es lo contrario: una compra
-- proporcional de las sesiones que restan, sin obligación ni condonación.
--
-- Sólo se admite como PRIMER pago del jugador dentro del período (las cuotas
-- anuales son ortogonales y no cuentan), en cualquiera de sus meses.

ALTER TABLE payments DROP CONSTRAINT payments_concept_valid;
ALTER TABLE payments ADD CONSTRAINT payments_concept_valid
  CHECK (concept IN ('monthly', 'session', 'membership dues', 'debt settlement', 'half month'));

-- Un medio mes nombra la sesión desde la que arranca: de ahí sale cuántas
-- sesiones compró, y con eso cuánto vuelve si el club después cancela alguna.
ALTER TABLE payments DROP CONSTRAINT payments_concept_session_rules;
ALTER TABLE payments ADD CONSTRAINT payments_concept_session_rules
  CHECK (
    (concept IN ('session', 'half month') AND session IS NOT NULL)
    OR (concept NOT IN ('session', 'half month') AND session IS NULL)
  );
