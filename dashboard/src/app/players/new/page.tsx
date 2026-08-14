"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState, Suspense } from "react";
import PhoneInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import "react-phone-number-input/style.css";
import ProtectedPage from "../../components/ProtectedPage";
import { usePageTitle } from "../../components/PageTitleContext";
import { DefaultCountry, isValidWhatsappPhone, normalizeWhatsappPhone } from "@/lib/phone";
import { DuplicateConfirmationPhrase, matchesConfirmationPhrase } from "@/lib/playerNames";

function NewPlayerPageContent() {
  const sp = useSearchParams();
  const returnTo = sp.get("returnTo") || "/";
  const inviteeParam = sp.get("invitee");
  const categoryParam = sp.get("category");
  const playerTypeParam = sp.get("player_type") as "player" | "goalkeeper" | null;

  const [playerType, setPlayerType] = useState<'member' | 'invitee' | null>(
    inviteeParam === 'true' ? 'invitee' : inviteeParam === 'false' ? 'member' : null
  );

  usePageTitle("Nuevo jugador");

  if (playerType === null) {
    return (
      <ProtectedPage requiredPage="/players/new">
        <div>
          <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="btnPrimary" onClick={() => setPlayerType('member')} style={{ width: "100%" }}>
              Socio
            </button>
            <button className="btnPrimary" onClick={() => setPlayerType('invitee')} style={{ width: "100%" }}>
              Invitado
            </button>
          </div>
        </div>
      </ProtectedPage>
    );
  }

  return (
    <ProtectedPage requiredPage="/players/new">
      <NewPlayerForm returnTo={returnTo} invitee={playerType === 'invitee'} defaultCategory={categoryParam} defaultPlayerType={playerTypeParam} />
    </ProtectedPage>
  );
}

export default function NewPlayerPage() {
  return (
    <Suspense fallback={<div style={{ padding: "20px", textAlign: "center" }}>Cargando...</div>}>
      <NewPlayerPageContent />
    </Suspense>
  );
}

/**
 * Phone input with a country selector, defaulting to Argentina.
 *
 * The preview matters as much as the flag: an Argentine mobile written "11 3456-7890"
 * is indistinguishable from a landline, so normalizeWhatsappPhone forces the mobile
 * marker on. Showing the stored value makes that transformation visible.
 */
function PhoneField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const normalized = normalizeWhatsappPhone(value);
  const invalid = value.trim().length > 0 && (normalized === null || !isValidWhatsappPhone(normalized));

  return (
    <label>
      {label}
      <PhoneInput
        international
        flags={flags}
        defaultCountry={DefaultCountry}
        value={value || undefined}
        onChange={(v) => onChange(v ?? "")}
        placeholder="11 3456-7890"
      />
      {value.trim() ? (
        <span style={{
          display: "block",
          marginTop: 4,
          fontSize: "0.75rem",
          opacity: invalid ? 1 : 0.7,
          color: invalid ? "crimson" : undefined,
        }}>
          {invalid ? "Número inválido" : `Se guarda como +${normalized}`}
        </span>
      ) : null}
    </label>
  );
}

type DuplicatePlayer = {
  id: string;
  name: string;
  last_name: string;
  dni: string | null;
  categories: string[] | null;
  invitee: boolean | null;
};

/**
 * Shown when the API finds players who look like the one being created. Saving stays
 * blocked until the admin types the confirmation phrase, so adding a genuine
 * namesake is a deliberate act rather than a mis-click.
 */
function DuplicateWarning({ duplicates, confirmation, onConfirmationChange }: {
  duplicates: DuplicatePlayer[];
  confirmation: string;
  onConfirmationChange: (v: string) => void;
}) {
  const confirmed = matchesConfirmationPhrase(confirmation);

  return (
    <div
      className="card"
      style={{
        marginTop: 16,
        borderColor: "var(--acemhh-orange)",
        borderWidth: 1,
        borderStyle: "solid",
      }}
    >
      <h3 style={{ color: "var(--acemhh-orange)", margin: "0 0 8px" }}>
        {duplicates.length === 1 ? "Ya existe un jugador parecido" : "Ya existen jugadores parecidos"}
      </h3>

      <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
        {duplicates.map((d) => (
          <li key={d.id} style={{ marginBottom: 4 }}>
            <strong>{d.name} {d.last_name}</strong>
            <span style={{ opacity: 0.75, fontSize: "0.85rem" }}>
              {" — "}{d.dni ? `DNI ${d.dni}` : "sin DNI"}
              {d.categories?.length ? `, ${d.categories.join(", ")}` : ""}
              {d.invitee ? ", invitado" : ""}
            </span>
          </li>
        ))}
      </ul>

      <p style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>
        Si es otra persona, escribí <strong>{DuplicateConfirmationPhrase}</strong> para confirmar.
      </p>

      <input
        value={confirmation}
        onChange={(e) => onConfirmationChange(e.target.value)}
        placeholder={DuplicateConfirmationPhrase}
        autoComplete="off"
      />

      {confirmation.trim() && !confirmed ? (
        <span style={{ display: "block", marginTop: 4, fontSize: "0.75rem", color: "crimson" }}>
          La frase no coincide.
        </span>
      ) : null}
    </div>
  );
}

function NewPlayerForm({ returnTo, invitee, defaultCategory, defaultPlayerType }: { returnTo: string; invitee: boolean; defaultCategory: string | null; defaultPlayerType: "player" | "goalkeeper" | null }) {

  const [name, setName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dni, setDni] = useState("");
  const [fechaNac, setFechaNac] = useState("");
  const [phone, setPhone] = useState("");
  const [guardianPhone, setGuardianPhone] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");
  // Ordered by priority: the first selected category is the player's main one.
  const [categories, setCategories] = useState<string[]>(defaultCategory ? [defaultCategory] : []);
  const [playerType, setPlayerType] = useState<"player" | "goalkeeper">(defaultPlayerType || "player");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicatePlayer[] | null>(null);
  const [confirmation, setConfirmation] = useState("");

  const categoryOptions = useMemo(() => [
    { value: "youth", label: "Juveniles" },
    { value: "cat-c", label: "Categoría C" },
    { value: "cat-b", label: "Categoría B" },
    { value: "cat-a", label: "Categoría A" },
  ], []);

  const toggleCategory = (value: string) => {
    setCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  };

  const submit = async () => {
    if (categories.length === 0) {
      setErr("Seleccioná al menos una categoría");
      return;
    }

    // Checked here only to fail fast with a readable message; the API normalizes and
    // validates again on its own.
    if (phone.trim() && !normalizeWhatsappPhone(phone)) {
      setErr("Revisá el celular");
      return;
    }

    if (guardianPhone.trim() && !normalizeWhatsappPhone(guardianPhone)) {
      setErr("Revisá el celular de madre/padre/tutor");
      return;
    }

    if (emergencyPhone.trim() && !normalizeWhatsappPhone(emergencyPhone)) {
      setErr("Revisá el celular del contacto de emergencia");
      return;
    }

    setLoading(true);
    setErr(null);
    const res = await fetch("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        last_name: lastName,
        ...(invitee ? {} : { dni }),
        fecha_nac: invitee ? null : (fechaNac || null),
        categories,
        invitee,
        player_type: playerType,
        // Sent in E.164 with the leading +, so the API can tell a foreign number
        // from a local one instead of re-parsing it as Argentine.
        phone: phone || null,
        guardian_phone: guardianPhone || null,
        emergency_contact_name: emergencyName.trim() || null,
        emergency_contact_phone: emergencyPhone || null,
        duplicate_confirmation: confirmation || null,
      }),
    });
    setLoading(false);

    // The API found players who look like this one and wants an explicit
    // acknowledgement before creating another.
    if (res.status === 409) {
      const body = (await res.json()) as { duplicates: DuplicatePlayer[] };
      setDuplicates(body.duplicates);
      setErr(null);
      return;
    }

    if (!res.ok) {
      setErr(await res.text());
      return;
    }
    const data = (await res.json()) as { player: { id: string } };
    window.location.replace(`${returnTo}?player=${encodeURIComponent(data.player.id)}`);
  };

  usePageTitle(invitee ? "Agregar Invitado" : "Nuevo jugador");

  return (
    <div>
      <div className="grid" style={{ marginTop: 12 }}>
        <label>
          Nombre
          <input value={name} onChange={(e) => { setName(e.target.value); setDuplicates(null); }} />
        </label>

        <label>
          Apellido
          <input value={lastName} onChange={(e) => { setLastName(e.target.value); setDuplicates(null); }} />
        </label>

        {!invitee && (
          <>
            <label>
              DNI
              <input value={dni} onChange={(e) => setDni(e.target.value)} />
            </label>

            <label>
              Fecha nac. (YYYY-MM-DD)
              <input value={fechaNac} onChange={(e) => setFechaNac(e.target.value)} placeholder="2000-01-31" />
            </label>
          </>
        )}

        <PhoneField label="Celular" value={phone} onChange={setPhone} />

        <PhoneField
          label="Celular Madre/Padre/Tutor"
          value={guardianPhone}
          onChange={setGuardianPhone}
        />

        <label>
          Contacto de emergencia
          <input
            value={emergencyName}
            onChange={(e) => setEmergencyName(e.target.value)}
            placeholder="Nombre y apellido"
          />
        </label>

        <PhoneField
          label="Celular contacto de emergencia"
          value={emergencyPhone}
          onChange={setEmergencyPhone}
        />

        <div>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>
            Categorías (en orden de prioridad: la primera es la principal)
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            {categoryOptions.map((c) => {
              const idx = categories.indexOf(c.value);
              const selected = idx >= 0;
              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => toggleCategory(c.value)}
                  style={{
                    padding: "10px 0",
                    borderRadius: 8,
                    border: selected
                      ? "2px solid var(--acemhh-green-3)"
                      : "1px solid rgba(255,255,255,0.15)",
                    background: selected
                      ? "rgba(36, 179, 91, 0.15)"
                      : "rgba(255,255,255,0.05)",
                    cursor: "pointer",
                    fontSize: "0.9rem",
                    fontWeight: selected ? 600 : 400,
                  }}
                >
                  {selected && categories.length > 1 ? `${idx + 1}. ` : ""}{c.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Posición</span>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {([
              { value: "player", label: "Jugador" },
              { value: "goalkeeper", label: "Arquero" },
            ] as const).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPlayerType(opt.value)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  borderRadius: 8,
                  border: playerType === opt.value
                    ? "2px solid var(--acemhh-green-3)"
                    : "1px solid rgba(255,255,255,0.15)",
                  background: playerType === opt.value
                    ? "rgba(36, 179, 91, 0.15)"
                    : "rgba(255,255,255,0.05)",
                  cursor: "pointer",
                  fontSize: "0.9rem",
                  fontWeight: playerType === opt.value ? 600 : 400,
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {duplicates ? (
        <DuplicateWarning
          duplicates={duplicates}
          confirmation={confirmation}
          onConfirmationChange={setConfirmation}
        />
      ) : null}

      {err ? <p style={{ color: "crimson", marginTop: 12 }}>{err}</p> : null}

      <div className="row" style={{ marginTop: 16 }}>
        <button
          className="btnPrimary"
          onClick={submit}
          disabled={loading || (duplicates !== null && !matchesConfirmationPhrase(confirmation))}
        >
          Guardar
        </button>
        <button onClick={() => window.location.href = returnTo} disabled={loading}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
