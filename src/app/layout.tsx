import type { Metadata, Viewport } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { DuoGate } from "@/components/duo-gate";
import { HydrateGate } from "@/components/hydrate-gate";
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
  description: "Bitácora privada de gym para dos. Qué toca hoy, qué peso llevas, cómo vas frente a tu dúo.",
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
        <DuoGate>
          <HydrateGate>
            <AppShell>{children}</AppShell>
          </HydrateGate>
        </DuoGate>
      </body>
    </html>
  );
}
