# Modelo de cobros

Las reglas de plata del club: qué se cobra, cómo se interpretan los pagos, cómo
nace y cómo se salda la deuda.

Está **implementado**. La matemática vive en `supabase/functions/_shared/tokens.ts`,
una sola vez para el dashboard y el bot, y sus reglas están una por una en
`supabase/functions/tests/tokens.test.ts`.

---

## Vocabulario

Tres palabras que el código actual usa mal y conviene fijar:

| Término | Qué es | Ejemplo |
|---|---|---|
| **Slot** | Día de la semana + hora. Es estable en el tiempo. | `jue 22hs` |
| **Sesión** | Un entrenamiento concreto: fecha + hora. | `2026-08-20 22hs` |
| **Features del slot** | Categorías y si entrenan arqueros. Pueden cambiar con el tiempo. | `{cat-a, cat-b}`, `goalies=false` |

La tabla que se llamaba `training_slots` guardaba en realidad **sesiones**, y
ya fue renombrada a `training_sessions`.

Y dos términos del modelo:

| Término | Qué es |
|---|---|
| **Token** | El derecho a asistir a una sesión. Es la unidad de todo el modelo. |
| **Carryover** | El vehículo que traslada tokens sin usar de un mes al siguiente. |

---

## Tokens

Un token es el derecho a asistir a **una** sesión. Los pagos no compran meses ni
sesiones específicas: compran tokens.

**El precio del token depende de cómo el admin lo venda**, y queda congelado en
el momento de la venta:

| Concepto | Precio por token |
|---|---|
| Mensual (promocional) | 25.000 |
| Medio mes (promocional) | 25.000 |
| Individual | 30.000 |
| Cualquiera, para el arquero del club | 20.000 |
| Cualquiera, para el arquero invitado | 25.000 |

Un pago mensual para el slot S en el mes M compra `n(S, M)` tokens, donde
`n(S, M)` es la cantidad de sesiones que tiene ese slot ese mes. Su precio
sugerido es `n(S, M) × 25.000`.

Los tokens **valen únicamente en el mes en que se compraron**. Lo que sobra
puede pasar al mes siguiente vía [carryover](#carryover), no por ser tokens.

Se admiten **tokens fraccionarios**: un pago arbitrario de 15.000 a precio
individual compra medio token. Es la vía normal para los montos improvisados.

### Medio mes

Para el que arranca el período con el mes ya empezado. **Compra las sesiones
que quedan** — esa incluida — a tarifa promocional, y nada más: no es un
anticipo, no deja obligación y no hay nada que condonar.

El precio lo deriva la pantalla de **en qué sesión se está cobrando**. En un mes
de 5 sesiones, cobrado en la 3ra son 3/5; cobrado en la 4ta, 2/5.

Sólo se admite como **primer pago del jugador dentro del período**, en
cualquiera de sus meses. Las cuotas anuales no cuentan: son ortogonales.

Sin este concepto, el que arranca a mitad de mes y paga 50k terminaba debiendo
el mes entero — el parcial mensual lo leía como un compromiso por las sesiones
que ni siquiera existieron para él.

### A qué slot pertenece un token

| Origen | Alcance |
|---|---|
| Pago mensual del slot S | **Sólo sesiones de S.** La asociación es fuerte. |
| Pago individual | Cualquier slot. |
| Carryover | Cualquier slot. Al pasar de mes se despega de su slot. |

Si alguien compró el mes de las 22hs y una semana va a las 23hs, ese token
mensual **no lo cubre**. El camino previsto es que el admin marque esa
asistencia como bonificada, a su criterio.

### Orden de consumo

El mes **abre** con los tokens que dejó el mes anterior (ver
[Carryover](#carryover)) y durante el mes se compran más. Cuando una asistencia
consume un token, se queman en este orden:

1. **El saldo de apertura** — lo heredado del mes anterior
2. **Promocionales del slot asistido** — mueren salvo que el club haya fallado
3. **Individuales** — pasan libremente al mes siguiente

Lo heredado va primero por ser saldo de apertura: se gasta lo que ya se tenía
antes que lo que se compra durante el mes. Y es además la única lectura que no
lo desperdicia, porque un token heredado no sobrevive otro mes.

Entre lo comprado, el criterio es quemar primero lo que antes se pierde, de modo
que al jugador le quede lo más flexible. Es una elección deliberada y cambia
números: ver [Decisiones tomadas](#decisiones-tomadas).

---

## Qué asistencias se cobran

No toda asistencia consume un token.

**Arqueros.** Sólo se les cobran las sesiones de slots con `goalies = true`. Un
arquero que va a las 22hs o a las 23hs no paga esa sesión. No se marca nada:
sale del flag del slot.

El arquero **invitado** paga más que el del club, y esa es la única cosa que el
flag `invitee` cambia — para un jugador de campo no cambia nada.

**Youth.** Un jugador de la categoría youth que asiste a la sesión de su propia
categoría un día dado tiene **una** asistencia adicional bonificada ese mismo
día. Si va a las 21, 22 y 23, una de las dos últimas es gratis y la otra
consume token.

Esta bonificación **se deriva, no se guarda**. Guardarla se desincroniza en dos
formas obvias: si el admin marca las 22hs antes que las 21hs el chequeo falla y
queda cobrable; y si después desmarca las 21hs, la de las 22hs queda bonificada
sin motivo. Con la ruedita de asistencia, marcar y desmarcar es trivial.

**Bonificación discrecional.** El admin puede marcar cualquier asistencia como
bonificada. Es el mecanismo para el jugador que recupera en otro slot, o para
cualquier acuerdo puntual.

Esta sí **se guarda**: es una decisión humana, un dato de entrada. No es
derivable de nada y no tiene el problema de desincronización de la anterior.

**Todos los demás.** Cada sesión asistida consume un token, incluso varias el
mismo día. Las categorías del jugador **no** determinan qué se le cobra: sirven
para mostrarlo en la lista y como metadata. Un cat-b que se cuelga en la sesión
de las 23hs paga esa sesión.

---

## Carryover

**El carryover no vive dentro del mes.** No es un tipo de token ni una entidad
con origen y vencimiento: es un método para evaluar que el mes anterior quedó
con **sesiones sin usar**, y cuántas de ellas se pueden usar en el mes que
empieza. El resultado es el saldo de apertura del mes siguiente.

Las sesiones sin usar vienen de dos lados:

- Sesiones individuales prepagas que no se usaron
- Un pago mensual por `n` sesiones en un mes que tuvo `n−1`: se cobró una sesión
  que, por culpa del club, no se pudo dar

De ahí sale la tabla:

| Origen del token | Cuánto pasa |
|---|---|
| Mensual (promocional) | `min(tokens sin usar, n(S,M) − sesiones que realmente se dieron)` |
| Medio mes | Igual, pero medido contra **las sesiones que le vendieron**, no contra el mes entero |
| Individual | Todos los que sobraron |
| Carryover del mes anterior | **Nada.** No hay segundo salto. |

La asimetría es el corazón del producto: **el token promocional se pierde si
faltaste**, y sólo vuelve en la medida en que el club no dio la sesión que
cobró. El individual vuelve siempre. Se pagan 5.000 de más por esa flexibilidad.

Los tokens heredados que no se usan **mueren ahí**. Sin esta regla, un token sin
usar se trasladaría indefinidamente.

### La unidad es la sesión, nunca el dinero

Lo que pasa de un mes al otro son **fracciones de sesión ya cubierta**, no
pesos. Un sobrante de 20.000 de un pago mensual no pasa como 20.000: pasa como
**0,8 de sesión**, porque a 25.000 el token eso es lo que compró. El mismo
sobrante de un pago individual pasa como 0,66 de sesión, porque ahí el token
costó 30.000.

Es lo que hace que un cambio de tarifa no toque lo ya comprado. Si el mes que
viene la sesión sale 35.000, esos 0,8 de sesión siguen valiendo 0,8 de sesión.

### Ejemplo

> Pago mensual de 100.000 para las 22hs (4 tokens), pero sólo se dieron 3
> entrenamientos a las 22hs. Más dos pagos individuales de 30.000 y 60.000 para
> las 23hs (1 + 2 = 3 tokens). Asistió a las 3 sesiones de las 22hs y a 2 de las
> 23hs.

Quemando en orden: las 3 asistencias a las 22hs consumen 3 promocionales; las 2
de las 23hs consumen 2 individuales (los promocionales sobrantes están atados a
las 22hs).

- Promocional: sobró 1, y el club dio 3 de 4 → pasa `min(1, 1) = 1`
- Individual: sobró 1 → pasa 1

**Carryover total: 2 tokens.**

---

## Deuda

La deuda tiene **dos fuentes**, y no se pisan entre sí.

### 1. Asistencias sin cubrir

Una asistencia cobrable sin token disponible genera deuda **a precio
individual** (30.000), sin importar si el jugador entrenó todas las sesiones del
slot ese mes. El descuento se gana pagando antes, no asistiendo mucho.

### 2. Pago mensual parcial sin saldar

Un pago mensual parcial **no es una compra proporcional**: es un anticipo.
Otorga los `n` tokens del mes completo y deja una obligación en pesos por el
resto.

> Paga 40.000 de un mes de 100.000. Recibe los 4 tokens y debe 60.000.
> No recibe 1,6 tokens.

**No se cuenta dos veces**: si hay un pago mensual para el slot S, aunque sea
parcial, las asistencias a S se liquidan por la vía del mes y no generan además
deuda a precio individual.

### Condonación al cierre del mes

Si el mes cierra con un parcial sin saldar, se evalúa una única vez:

- Sea `A` la cantidad de asistencias cobrables a ese slot en el mes
- Si `parcial ≥ A × 30.000` → **se condona el resto**, deuda 0
- Si no → deuda = `valor del mes − parcial`

| Paga | Asiste | Debe | Total del mes |
|---|---|---|---|
| 90.000 | 3 sesiones | 0 — condonado, 90.000 ≥ 3×30.000 | 90.000 |
| 89.000 | 3 sesiones | 11.000 — 89.000 < 90.000 | 100.000 |
| 40.000 | 1 sesión | 0 — condonado, 40.000 ≥ 30.000 | 40.000 |
| 40.000 | 2 sesiones | 60.000 — 40.000 < 60.000 | 100.000 |

**Esto tiene un escalón filoso y es a propósito.** La segunda asistencia del
último caso cuesta 60.000 de golpe, y al jugador le hubiera convenido no comprar
el mes (dos sesiones sueltas son 60.000, no 100.000). Un peso menos de pago
cuesta 11.000 en el segundo caso.

La intención de pagar el mes tiene un beneficio —el descuento— a cambio de un
compromiso. Quien usó el mes de verdad no puede bajarse; quien casi no lo usó
recibe una condonación generosa.

### Dos deudas distintas

Hacen cosas distintas y no hay que confundirlas:

| | Qué es | Efecto |
|---|---|---|
| **Deuda cerrada** | Meses anteriores sin saldar | Bloquea, ver [Bloqueos](#bloqueos) |
| **Saldo del mes** | Asistencias sin cubrir o parcial sin completar, del mes en curso | Alerta y se muestra como deuda |

El saldo del mes **se muestra como deuda firme**, aunque pueda condonarse al
cierre. Si el admin lo reclama es porque el jugador fue; si después se condona,
el jugador se pone contento y no es un problema del admin.

---

## Reglas de la UI

### Pago mensual

- Sólo puede registrarse **hasta la segunda sesión del slot** que se está
  pagando, más **un día de gracia** (por si el admin bajó los cobros a papel y
  los vuelca al día siguiente).
- La primera semana admite un **pago parcial, mínimo 40.000**. Desde la segunda
  semana el resto ya es saldo del mes.
- Un parcial sólo puede completarse con un pago que llegue al **100%** del valor
  mensual de ese slot. No hay tercer parcial.

### No mezclar conceptos

Para una misma combinación **(mes, slot)** no se pueden mezclar pagos mensuales
e individuales. Desde el primer pago, la decisión está tomada.

> No se puede pagar 30.000 en la primera sesión, 30.000 en la segunda, y saldar
> el mes con 40.000 en la tercera.

Es una **política de la UI, no una necesidad del cálculo**: con tokens, 4 a
25.000 más 1 a 30.000 es perfectamente calculable. Si alguna vez se viola, la
matemática igual da bien.

### Bloqueos

El bloqueo lo aplica **el servicio, no sólo la UI**. Es una regla de plata: si
vive únicamente en la pantalla, cualquier reintento, pestaña vieja o llamada
directa la saltea.

Es **dirigido**: siempre se puede pagar lo que se debe, en la forma que
corresponde; no se puede avanzar con otra cosa mientras tanto.

| Deuda | Bloquea | Habilita |
|---|---|---|
| **Cerrada** | Todos los pagos mensuales e individuales | Sólo pago de deuda |
| **Sesión impaga del mes**, slot S, sesión X | Pago de otras sesiones; mensual de otros slots | Mensual de **S**; individual de **X** |
| **Parcial mensual** del slot S | Individuales de **S** | Segundo parcial que complete el 100% de S; cualquier pago de **otros slots** |

Esto es lo que evita que asistir antes de pagar cueste el descuento: quien debe
la sesión de un slot todavía puede comprar el mes **de ese slot** y quedar
cubierto.

### Pago de deuda

Concepto propio. Monto en el intervalo `(0, deuda total]` — no se puede pagar
más deuda de la que hay. Si el jugador quiere saldar deuda y además pagar el mes,
son **dos pagos**.

Sólo se ofrece la opción cuando efectivamente hay deuda.

### Marcar presente

Si el jugador tiene deuda cerrada **o** saldo del mes, marcar presente muestra
un **popup de confirmación**.

**Alerta, nunca impide.** Si el admin decide dejarlo entrenar igual, queremos el
presente marcado: saber quién estuvo es más importante que la cobranza.

### Pagos múltiples

Un jugador puede tener varios pagos el mismo día — por ejemplo, el mensual de
dos slots distintos. Ya funciona: no hay restricción de unicidad en `payments`.

---

## Ventana de escritura

Se puede escribir en la **semana en curso y la anterior** (lunes a domingo, hora
de Buenos Aires). Aplica a **cobros y asistencias**.

Reescribir más atrás requiere acceso directo a la base.

La agenda se modifica sólo por SQL.

Con entrenamientos los jueves, la ventana nunca corta entre un entrenamiento y
su cobro, ni siquiera cuando se registra pasada la medianoche.

## Alcance temporal del cálculo

El cálculo se clampea **dentro del período**, y la deuda y el carryover no
cruzan de un período al siguiente.

Los períodos **no son semestres**: el club entrena de **marzo a julio** y de
**agosto a diciembre**. Son dos tramos de cinco meses.

Enero y febrero son el receso: no hay entrenamientos, así que forman un período
propio que siempre queda vacío.

Los análisis cruzando períodos son discrecionales y manuales.

---

## Qué cambia respecto de lo implementado

### Reglas que el modelo de tokens retira

**El bundle incompleto.** Hoy existe una regla que dice que un pago cercano al
bundle "es una compra incompleta del mes" y cobra el mes entero, con tope en las
sesiones sueltas. Con tokens no hay ambigüedad que resolver: plata ÷ precio =
tokens. El pago parcial del mes se modela como anticipo, que es más honesto.

**La interpretación de conceptos mezclados.** No hace falta decidir qué
significa una mezcla de pagos: cada uno compró sus tokens.

**El carryover en pesos con origen y vencimiento.** Se reemplaza por un número
de tokens.

### La agenda como entrada del cálculo

Con tokens, la agenda deja de entrar en la liquidación casi por completo:

- Tokens que entran = pagos ÷ precio
- Tokens que salen = asistencias cobrables

La agenda sobrevive como entrada en **un solo lugar**: el tope del carryover
promocional, que compara los tokens comprados contra las sesiones que realmente
se dieron. Editar la agenda de un mes cerrado todavía mueve cuánto carryover
pasó al siguiente.

Es angosto y deliberado, pero está.

### `payments.slot` es dato crítico

Deja de ser trazabilidad: es la entrada del tope de carryover promocional y de
las validaciones de conceptos incompatibles. Hoy es un string armado con locale
español (`"jue 22hs"`, vía `toLocaleString`), lo cual es frágil para algo de lo
que depende plata.

---

## Dónde vive cada cosa

| Qué | Dónde |
|---|---|
| La matemática: tokens, consumo, carryover, deuda, condonación | `supabase/functions/_shared/tokens.ts` |
| Qué asistencias se cobran | idem, `billableAttendances` |
| Qué se puede registrar y cuándo | idem, `checkPayment` y `withinWriteWindow` |
| Las reglas, una por una | `supabase/functions/tests/tokens.test.ts` |
| Enriquecer la lista de la pantalla | `dashboard/src/lib/rosterLedger.ts` |
| El mensaje del bot | `supabase/functions/whatsapp-webhook/status.ts` |
| Los bloqueos aplicados | las rutas de pago y asistencia |

**Una sola implementación.** Estaba escrita dos veces y dos copias de reglas de
plata derivan: el bot le diría al jugador un número y el admin vería otro. No se
resolvió con una edge function llamada por HTTP — la pantalla de asistencia
enriquece decenas de jugadores con acceso directo a la base, y un salto de red
ahí es una regresión y un modo de falla nuevo. Lo que legítimamente difiere
entre runtimes es cómo se traen los datos, no la aritmética.

**El archivo compartido no importa nada.** Deno pide extensión `.ts` en los
imports y Next no; mientras el módulo no importe, los dos lo consumen igual.

## Dos cosas que sorprenden en la práctica

**El mes casi nunca está disponible.** Se compra hasta un día después de la
segunda sesión del slot, así que pasada la primera quincena la única opción es
la sesión suelta. Es el diseño —el precio promocional se gana pagando por
adelantado— pero conviene saberlo antes de que un admin pregunte.

**En el primer mes de un período no puede haber deuda cerrada.** La deuda son
meses cerrados y el cálculo no cruza períodos, así que en marzo y en agosto el
bloqueo por deuda no se activa nunca. Recién empieza a valer en el segundo mes.

## Sesiones extraordinarias

Una sesión que caiga en un `(día de la semana, hora)` sin features definidas
**no se resuelve sola: la consulta falla**. Es deliberado. Adivinar categorías
significa cobrarle a quien no corresponde, y eso es peor que una pantalla rota.

La consecuencia operativa: crear una sesión extraordinaria son **dos inserts**,
la sesión y sus features. Van juntos.

Una propiedad a tener presente: las features se identifican por
`(día de la semana, hora)`, así que una fila creada para un martes 20hs puntual
rige desde esa fecha en adelante para **todos** los martes 20hs. Si no hay otros,
no molesta.
