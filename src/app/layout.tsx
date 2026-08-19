import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
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
  title: "Duo Lift",
  description: "Registro de entrenamiento para dos. Circuitos, series y progreso compartido.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className={`${archivo.variable} ${plex.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background font-sans text-foreground">
        <HydrateGate>
          <AppShell>{children}</AppShell>
        </HydrateGate>
      </body>
    </html>
  );
}
