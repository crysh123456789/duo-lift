import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono } from "next/font/google";
import localFont from "next/font/local";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { HydrateGate } from "@/components/hydrate-gate";
import { SyncProvider } from "@/components/sync-provider";
import "./globals.css";

// Self-hosted latin subset. next/font/google emits unicode-range U+0000-00FF,
// and the CSS pipeline turns that into U+??, so í falls through to a clipped fallback.
const archivo = localFont({
  src: "../fonts/archivo-latin.woff2",
  variable: "--font-archivo",
  weight: "100 900",
  display: "swap",
  adjustFontFallback: false,
});

const plex = IBM_Plex_Mono({
  variable: "--font-plex",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Duo Lift",
    template: "%s",
  },
  description: "Tu bitácora de gym. Qué toca hoy, qué peso llevas y cómo vas.",
  applicationName: "Duo Lift",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Duo Lift",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c0d0a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <HydrateGate>
          <AuthGate>
            <SyncProvider>
              <AppShell>{children}</AppShell>
            </SyncProvider>
          </AuthGate>
        </HydrateGate>
      </body>
    </html>
  );
}
