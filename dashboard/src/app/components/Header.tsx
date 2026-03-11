import Image from "next/image";

export default function Header() {
  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      marginBottom: 16,
      paddingBottom: 8,
      borderBottom: "1px solid rgba(255,255,255,0.1)",
      minHeight: 45
    }}>
      <div style={{ width: 45, height: 45, position: "relative", display: "flex", alignItems: "center" }}>
        <Image
          src="/acemhh-logo.png"
          alt="ACEMHH Logo"
          fill
          style={{ objectFit: "contain", objectPosition: "center" }}
        />
      </div>
    </header>
  );
}
