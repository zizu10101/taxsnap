import type { Metadata, Viewport } from "next";
import { Barlow_Semi_Condensed, IBM_Plex_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { RegisterServiceWorker } from "@/components/register-sw";
import "./globals.css";

const bodySans = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const headingSans = Barlow_Semi_Condensed({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const numberMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: {
    default: "TaxSnap — Snap receipts, sort your tax write-offs",
    template: "%s",
  },
  description:
    "TaxSnap helps self-employed trade contractors snap photos of receipts, auto-categorize tax write-offs with AI, and export clean data for tax season.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TaxSnap",
  },
  other: {
    // Next 16 only emits the modern unprefixed `mobile-web-app-capable` tag
    // for appleWebApp.capable; Safari only honors that one from iOS 16.4+
    // (2023). This legacy tag keeps standalone install working on older
    // iOS versions still in the field.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#211D18",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${bodySans.variable} ${headingSans.variable} ${numberMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {children}
        <Toaster />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
