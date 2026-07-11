import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldhand | Farm intelligence",
  description: "A context-aware field operations agent for corn growers.",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = { themeColor: "#17392d", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
