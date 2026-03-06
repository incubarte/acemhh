# /asistpago Manual Test Scenarios

This document lists manual test scenarios to validate the `/asistpago` flow, including:

- Attendance toggling
- Payment registration
- Optimistic UI updates (emoji flip + conditional final rerender)
- Concurrency / stale data refresh
- Idempotency (duplicate taps)

## Preconditions

- Bot deployed and reachable by Telegram.
- DB has a few players for at least one category (e.g. `cat-b`).
- At least one valid session day/slot exists (e.g. Thu `21hs`).
- You can access Supabase tables:
  - `public.attendances`
  - `public.payments`
  - `public.players`

## Helpful Observability

Watch function logs for:

- `asistpago_timing ...`
- `asistpago_full_timing ...`
- `asistpago_buildkb_timing ...`

Also watch Supabase Dashboard:

- **Observability** -> **Data API**

## Scenario 1: Basic `/asistpago` render

1. Trigger `/asistpago` for a given session.
2. Confirm the player list renders.

Expected:

- Each player row has:
  - Attendance button: `🙂` or `🫥` at the left of the name.
  - Payment button:
    - `Registrar Pago` when paid amount is 0.
    - `⚠️ <amount>` when partially paid.
    - `💶 <amount>` when at/above threshold.

## Scenario 2: Attendance toggle writes correct DB value

1. Pick a player `P`.
2. Tap the attendance button once.
3. Query the DB:
   - `select * from attendances where session = <specificSlot> and player_id = <P>`

Expected:

- A row exists for `(session, player_id)`.
- `attended` matches the last tap outcome.

## Scenario 3: Rapid attendance toggling (same player)

Goal: ensure the final UI state equals the DB state after rapid taps.

1. Pick a player `P`.
2. Tap attendance quickly 5-10 times.
3. Wait ~2 seconds.
4. Query DB row for `(specificSlot, P)`.

Expected:

- The final emoji on screen (🙂/🫥) matches `attended` in DB.
- No duplicate rows exist (unique key should be respected).

Notes:

- This verifies that:
  - optimistic UI is not permanently diverging
  - upsert is idempotent on `(session, player_id)`

## Scenario 4: Optimistic edit happens (instant emoji flip)

1. Pick a player `P`.
2. Tap attendance.

Expected:

- Emoji flips immediately (reply_markup update).
- Even on slow networks, user sees the updated emoji quickly.

## Scenario 5: Conditional rerender skip (no flicker)

Goal: verify we avoid flicker when the optimistic keyboard already matches the final rebuilt keyboard.

1. Pick player `P`.
2. Tap attendance once.
3. Watch logs.

Expected:

- You should see logs containing:
  - `(skipped_rerender_equal)`
- Visually there should be no “second repaint” / flicker after the immediate emoji flip.

## Scenario 6: Concurrency / stale data refresh triggers final rerender

Goal: verify that if data changes in the backend (from another admin/device), we do *not* skip rerender.

Setup:

- Open the same `/asistpago` message on **Device A** and **Device B**.

Steps:

1. On Device B, register a payment for player `P` (or toggle a different player’s attendance).
2. Without interacting further on Device A, tap attendance for some player (any) to trigger the flow.

Expected:

- If the rebuilt keyboard differs from the optimistic one, the bot performs the final `editMessageText`.
- Device A should update to reflect the backend changes (e.g. payment status changed, amount shown).
- Logs should *not* show `(skipped_rerender_equal)` for that tap.

## Scenario 7: Optimistic edit rejected by Telegram (fallback to full rebuild)

This can be hard to reproduce on purpose. Some ways to increase likelihood:

- Tap very quickly while another device edits the same message.
- Let the message get outdated and then trigger edits.

Expected:

- If the optimistic reply_markup edit fails, the handler still performs the full rebuild and updates the message.
- UI ends up consistent with DB.

## Scenario 8: Payment expand/collapse does not break attendance

1. Pick player `P`.
2. Tap payment button (it should expand payment options).
3. Tap attendance for the same player.

Expected:

- Attendance toggles correctly.
- Expanded state should behave consistently (may collapse depending on rebuild behavior).

## Scenario 9: Payment idempotency (duplicate taps)

1. Expand payment options for player `P`.
2. Tap `100k` twice quickly.

Expected:

- Only one payment record is inserted for that deterministic id.
- Second tap returns callback query message like `Pago ya registrado`.
- UI should remain stable and reflect a paid amount (depending on threshold).

## Scenario 10: Custom amount payment reply flow

1. Expand payments for player `P`.
2. Tap `Otro`.
3. Reply with a valid amount.

Expected:

- A payment row is inserted.
- Month/slot fields are correct.
- UI updates accordingly.

## Scenario 11: Month-to-date attendance count correctness

1. Choose a date that is not the first slot day of the month.
2. For player `P`, mark attended on multiple earlier slot days in same month.
3. Load `/asistpago` for a later day.

Expected:

- The count `(n)` shown matches attended sessions earlier in the month for the same hour/weekday slot.
- Count excludes the selected session day itself.

## Scenario 12: Payment grouping and threshold

1. Register several payments for player `P` in the selected month.
2. Confirm:

Expected:

- Under-threshold players remain in `--- Deben: ---`.
- At/above-threshold players move to `--- Pagaron: ---`.
- `Registrar Pago` only appears when total paid is 0.

## Cleanup / Reset

If tests leave the DB dirty, clean up the specific `attendances` and `payments` rows for the test `session/month/slot` and the test player ids.
