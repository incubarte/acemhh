# Torneos

Cómo se modelan los torneos y cómo se cobra la cuota de participación. La
aritmética vive en `dashboard/src/lib/tournamentFees.ts`, una sola vez, y sus
reglas están una por una en `dashboard/e2e/tournament-fees.spec.ts`.

---

## Estructura

| Tabla | Qué es |
|---|---|
| `tournaments` | Un torneo. `is_active` dice si se muestra. Puede haber varios activos, o ninguno. |
| `tournament_categories` | Las categorías de **ese** torneo (Elite, Master, Senior, Rookies), con su precio anticipado. |
| `tournament_installments` | Una fila por mes y categoría: la cuota de ese mes. |
| `teams` | Un equipo, de una categoría de su torneo. |
| `team_players` | Quién integra cada equipo y si es `starter` o `substitute`. |

Un jugador puede estar en varios equipos, incluso del mismo torneo. La
clave de `team_players` es `(equipo, jugador)`, no `jugador`.

El esquema de cuotas es **por categoría del torneo**, no global: el próximo
torneo trae sus propias filas en `tournament_categories` e
`tournament_installments`, y puede tener otros meses, otros montos u otras
categorías sin tocar código.

## La cuota

**Se cobra por equipo integrado.** El pago se registra desde la lista del
equipo y queda atado a él (`payments.team_id`). Quien juega en dos equipos
tiene dos cuotas.

**Los arqueros no pagan.** Sale de `players.player_type = 'goalkeeper'`, no de
la lista: integran el equipo, pero no tienen puntos, no cuentan como al día ni
como deudores, y el servicio rechaza registrarles un pago.

**Cada mes es una cuota, y los pagos no dicen a qué mes van.** Se admite
cualquier monto — puede pagar menos o más que una cuota — y lo pagado se aplica
a las cuotas en orden. Lo que importa es cuánto lleva pagado contra cuánto
debería llevar pagado a la fecha.

De ahí sale un punto por mes:

| Punto | Significa |
|---|---|
| Verde | La cuota está cubierta entera |
| Amarillo | Algo, no todo |
| Rojo | Nada, y el mes ya llegó |
| Gris | Nada, pero todavía no hace falta |

> En octubre, con septiembre entero y el 40% de octubre pagados: verde,
> amarillo, gris, gris. Debe el 60% de octubre; noviembre y diciembre no se
> reclaman todavía.

"Al día" es no deber nada de lo ya vencido. Pagar de más adelanta cuotas.

### El torneo anticipado

Quien **no pagó nada** y **la primera cuota todavía no venció** puede pagar el
torneo entero por menos que la suma de las cuotas (`upfront_price` de la
categoría). Es un concepto propio, `tournament upfront`, porque cambia cuánto
es el total: de ahí en más las cuotas se leen a escala de ese precio y el
jugador queda saldado.

El servicio lo rechaza fuera de esa regla — ya pagó algo, la primera cuota
venció, o el monto es menor que el precio anticipado — porque es una regla de
plata y no puede vivir sólo en el botón.

### En `payments`

| Columna | Cuota de torneo |
|---|---|
| `concept` | `tournament` o `tournament upfront` |
| `team_id` | El equipo. Obligatorio para estos conceptos, nulo para el resto. |
| `month` | Cuándo se cobró, no a qué cuota va. La columna es obligatoria para todo concepto. |
| `slot_weekday`, `slot_hour`, `session` | Nulos: el torneo no pertenece a ningún entrenamiento. |
| `is_cash` | `false` desde la pantalla: la cuota va a la cuenta del club, como la cuota social, y no toca la caja de nadie. La ruta acepta `true` por si alguna vez se cobra en efectivo; la caja lo lista como "torneo". |

Todo lo que lee `payments` filtra por lista de conceptos, así que los pagos de
torneo no entran al ledger de entrenamientos, al análisis ni a la credencial.

## Clausura 2026

La migración `20260914100000_tournaments.sql` deja creado el Interclubes
Clausura 2026 con estas cuotas:

| Categoría | Sep | Oct | Nov | Dic | Suma | Anticipado |
|---|---|---|---|---|---|---|
| Elite | 60.000 | 55.000 | 55.000 | 25.000 | 195.000 | 178.000 |
| Master | 100.000 | 90.000 | 85.000 | 35.000 | 310.000 | 282.000 |
| Senior | 80.000 | 75.000 | 70.000 | 30.000 | 255.000 | 232.000 |
| Rookies | 50.000 | 50.000 | 45.000 | 20.000 | 165.000 | 151.000 |

Las tarifas se acordaron como A/B/C/D y acá están mapeadas en el orden de las
categorías. **Si el mapeo es otro, es un UPDATE sobre esas filas**, no un
cambio de código.

Los equipos y sus jugadores entran con una migración propia, generada por
`scripts/tournament-roster.ts` a partir de `backfill/interclubes-clausura-2026.csv`
(ver `scripts/README.md`): `20260914110000_clausura_2026_teams.sql`. El torneo,
sus categorías y sus equipos llevan ids fijos para que local y producción
coincidan y el import de producción copie `team_players` tal cual.

Con el torneo nació la categoría de entrenamiento `cat-d`
(`20260914120000_rookies_cat_d.sql`): los jugadores del equipo D cambian
`cat-c` por `cat-d` y conservan `youth` si la tenían, y el horario de las 23hs
admite `cat-d` además de `cat-c`.

## Pantallas

- `/torneos` — los torneos activos (pestañas si hay más de uno), sus
  categorías y equipos. Cada equipo dice cuántos jugadores tiene, cuántos
  deben, y cuánto se cobró de lo que debería llevarse cobrado.
- `/torneos/equipos/<equipo>` — titulares y suplentes, cada uno con su línea
  ("al día", "debe $X", "torneo saldado") y sus puntos. Tocar la fila abre el
  detalle: cuota por cuota, los pagos registrados y el botón de registrar pago.
- El pago ofrece primero completar lo vencido (o la próxima cuota si está al
  día), después el torneo anticipado cuando corresponde, y un monto libre. "45"
  quiere decir 45.000, como en la pantalla de entrenamientos. No hay botones de
  cancelar ni de volver: tocar afuera cierra y devuelve a la lista, y un pago
  registrado también cierra todo, para seguir con el siguiente jugador.

Los permisos son de `WHEEL`: el mismo grupo que cobra los entrenamientos.
