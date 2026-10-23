import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";
import { HydrateGate } from "@/components/hydrate-gate";
import { SyncProvider } from "@/components/sync-provider";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
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
