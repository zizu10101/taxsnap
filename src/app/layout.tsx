import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Barlow_Semi_Condensed, IBM_Plex_Mono, Inter } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { RegisterServiceWorker } from "@/components/register-sw";
import "./globals.css";

// Resolves and applies the theme class before hydration, so there's no
// flash of the wrong theme. Deliberately not imported from lib/theme.ts -
// this has to be a standalone string with zero module dependencies,
// since it runs via strategy="beforeInteractive" before any app code
// exists. Keep this logic in sync with lib/theme.ts's resolveIsDark by
// hand if either one changes.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var pref = stored === "light" || stored === "dark" || stored === "system" ? stored : "light";
    var isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;

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
        <Script id="theme-init" strategy="beforeInteractive">
          {THEME_INIT_SCRIPT}
        </Script>
        {children}
        <Toaster />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
