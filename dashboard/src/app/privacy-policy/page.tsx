"use client";

import { usePageTitle } from "../components/PageTitleContext";

// Placeholder policy: written to satisfy platform requirements (e.g. Meta's
// app review) while the comisión drafts the real one. Content is a draft.

const LastUpdated = "14 de agosto de 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: "1.05rem", fontWeight: 600, marginBottom: 8 }}>{title}</h2>
      <div style={{ fontSize: "0.95rem", lineHeight: 1.6, opacity: 0.9 }}>{children}</div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  usePageTitle("Política de Privacidad");

  return (
    <div style={{ paddingBottom: 40 }}>
      <p style={{ marginTop: 12, fontSize: "0.8rem", opacity: 0.6 }}>
        Última actualización: {LastUpdated} — documento de prueba, pendiente de revisión
        por la comisión.
      </p>

      <Section title="Quiénes somos">
        <p>
          ACEMHH (Asociación Civil de Ex Alumnos del Colegio Manuel Belgrano — Hockey sobre
          patines) administra este sitio y sus canales de contacto de WhatsApp y Telegram
          para la gestión deportiva y administrativa del club.
        </p>
      </Section>

      <Section title="Qué datos recopilamos">
        <p>
          Datos de socios y jugadores necesarios para la actividad del club: nombre y
          apellido, DNI, fecha de nacimiento, categoría, teléfono de contacto, teléfono de
          madre/padre/tutor en el caso de menores, contacto de emergencia, asistencia a
          entrenamientos y registros de pagos de cuotas.
        </p>
        <p style={{ marginTop: 8 }}>
          Si nos escribís por WhatsApp o Telegram, procesamos tu número o usuario y el
          contenido del mensaje únicamente para responder la consulta.
        </p>
      </Section>

      <Section title="Para qué los usamos">
        <p>
          Exclusivamente para la gestión del club: organización de entrenamientos y
          categorías, control de asistencia, administración de cuotas y comunicación con
          socios y tutores. No usamos los datos con fines publicitarios.
        </p>
      </Section>

      <Section title="Con quién los compartimos">
        <p>
          No vendemos ni cedemos datos personales a terceros. Los datos se almacenan en
          proveedores de infraestructura (Supabase, Vercel, Meta/WhatsApp, Telegram) que
          actúan como encargados del tratamiento según sus propios términos.
        </p>
      </Section>

      <Section title="Cuánto tiempo los conservamos">
        <p>
          Mientras la persona sea socia o jugadora del club, y por el tiempo adicional que
          exijan obligaciones legales o administrativas de la asociación civil.
        </p>
      </Section>

      <Section title="Tus derechos">
        <p>
          De acuerdo con la Ley 25.326 de Protección de Datos Personales (Argentina),
          podés solicitar el acceso, la rectificación o la supresión de tus datos
          escribiendo a la comisión directiva. La Agencia de Acceso a la Información
          Pública es el órgano de control de la ley.
        </p>
      </Section>

      <Section title="Contacto">
        <p>
          Por consultas sobre esta política, escribinos a la comisión directiva del club a
          través de los canales habituales de contacto.
        </p>
      </Section>
    </div>
  );
}
