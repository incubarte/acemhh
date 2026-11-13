# Actividad

Un registro de lo que hace cada persona en el dashboard, para responder
"lo cargué" contra "no está". Se lee en **🕵️ Actividad** (solo ROOT), un día
a la vez.

## Tres fuentes

| | Quién la escribe | Qué dice |
|---|---|---|
| **UI** | el teléfono (`lib/activity.ts`, `components/ActivityTracker.tsx`) | navegación, toques, valores cargados, alertas y preguntas, y cada envío al servidor (`submit`) |
| **API** | el servidor, en `withPermission` | cada pedido que cambia algo, con la respuesta (`→ 200`, `→ 409 "motivo"`) |
| **DB** | triggers en `payments`, `attendances`, `players`, `expenses`, `incomes`, `cash_handoffs` | cada alta, cambio (solo los campos que cambiaron) y baja |

Un `submit` genera un trace que viaja con el pedido (`x-activity-trace`) y
llega a la base por PostgREST, así que las tres líneas de un cobro quedan
atadas. Tocar una línea en la pantalla muestra solo esa cadena. Si falta un
eslabón, ahí se cortó: no salió del teléfono, llegó y lo rechazaron, o se
aceptó y no se guardó.

En la base, quien escribió sale del encabezado `x-activity-actor`. Sin él:
`servicio` (el bot de Telegram, las edge functions) o `manual` (una conexión
directa: el editor de tablas o el SQL de Supabase, una migración).

## Cómo llegan las líneas del teléfono

Cada acción se guarda primero en `localStorage` y se manda en el momento.
Cuando el servidor confirma, se borra. Si no se pudo mandar, se reintenta (5s,
15s, 30s, 60s), al volver la señal, al volver a la pestaña y al cerrarla
(`sendBeacon`). Si la pantalla se cerró antes, la manda la próxima que se abra
en ese navegador. Una pantalla solo toma las líneas de otra cuando esa dejó de
avisar que sigue viva (`activity-alive:*`, cada 10s, se da por muerta a los
150s).

Cada línea dice cómo llegó:

- `en vivo`: al primer intento.
- `reintento ×N, +demora`: no salió en el momento. `después de cerrar` si la
  pantalla que la generó ya se había cerrado.

La demora se mide con el reloj del teléfono, así que vale aunque esté mal en
hora; la línea se ubica con el reloj del servidor menos esa demora. Cada
pestaña numera sus líneas: un salto en la numeración es una línea que nunca
llegó y la pantalla lo marca.

Se pierde solo si el envío falló **y** además se borran los datos del
navegador, era modo incógnito, Safari limpió el sitio tras 7 días sin uso, o
no se vuelve a abrir el dashboard en ese navegador.

## La tabla

`activity_log` solo admite altas: un trigger rechaza `UPDATE`, `DELETE` y
`TRUNCATE`. Las páginas públicas (login, credencial) no se registran.
