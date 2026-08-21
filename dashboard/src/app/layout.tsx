import type { ReactNode } from "react";
import Script from "next/script";

import "./globals.css";
import TopStack from "./components/TopStack";
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
          <TopStack />
          <div className="container">
            <div className="appShell">
              {children}
            </div>
          </div>
        </PageTitleProvider>
      </body>
    </html>
  );
}
