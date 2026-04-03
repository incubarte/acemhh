import type { ReactNode } from "react";
import Script from "next/script";

import "./globals.css";
import Header from "./components/Header";
import { PageTitleProvider } from "./components/PageTitleContext";

export const metadata = {
  title: "ACEMHH Dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        <PageTitleProvider>
          <div className="container">
            <div className="appShell">
              <Header />
              {children}
            </div>
          </div>
        </PageTitleProvider>
      </body>
    </html>
  );
}
