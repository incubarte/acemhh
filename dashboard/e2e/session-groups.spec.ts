import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

// The groups come from the users table on every request, not from the login:
// a promotion or a revocation applies right away, and the device's cookie is
// rewritten to carry the new ones.

const admin = () => createClient(
  process.env.SUPABASE_URL ?? "http://127.0.0.1:54321",
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU",
  { auth: { persistSession: false } },
);

test("un cambio de grupos aplica en el próximo pedido, sin volver a entrar", async ({ page }) => {
  await page.request.post("/api/auth/dev");
  const me = await (await page.request.get("/api/me")).json();
  const original: string[] = me.groups;
  expect(original).toContain("ROOT");
  const cookie = async () => (await page.context().cookies()).find((c) => c.name === "dash_session")!.value;
  const loginCookie = await cookie();

  const s = admin();
  try {
    // Se le saca ROOT: deja de ver lo de ROOT sin que nadie toque la sesión.
    await s.from("users").update({ groups: ["WHEEL"] }).eq("id", me.id);
    expect((await page.request.get("/api/activity")).status()).toBe(403);
    expect((await (await page.request.get("/api/me")).json()).groups).toEqual(["WHEEL"]);
    const rewritten = await cookie();
    expect(rewritten).not.toBe(loginCookie);

    // Lo de WHEEL sigue andando.
    expect((await page.request.get("/api/check-permission?type=page&resource=/caja")).status()).toBe(200);
    expect((await page.request.get("/api/check-permission?type=page&resource=/actividad")).status()).toBe(403);

    // Se lo promueve de vuelta: lo ve en el acto.
    await s.from("users").update({ groups: original }).eq("id", me.id);
    expect((await page.request.get("/api/check-permission?type=page&resource=/actividad")).status()).toBe(200);
    // Sin parámetros responde 400: ya pasó el permiso.
    expect((await page.request.get("/api/activity")).status()).toBe(400);
    // Mientras no cambien, la cookie no se reescribe.
    const settled = await cookie();
    await page.request.get("/api/me");
    expect(await cookie()).toBe(settled);
  } finally {
    await s.from("users").update({ groups: original }).eq("id", me.id);
  }
});
