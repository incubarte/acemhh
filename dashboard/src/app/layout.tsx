import type { ReactNode } from "react";
import Script from "next/script";

import "./globals.css";
import Header from "./components/Header";

export const metadata = {
  title: "ACEMHH Dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <div className="container">
          <div className="appShell">
            <Header />
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
