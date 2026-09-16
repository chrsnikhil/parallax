import { readFileSync } from "node:fs";
import path from "node:path";

import { Space_Grotesk, Geist_Mono } from "next/font/google";

// finbro's typefaces, self-hosted at build (no runtime CDN). Exposed only as CSS
// variables — no global font-family is set — so the hero keeps its TASA Orbiter
// face and only the wallet (.kh-app) opts in via --kh-font-sans / --kh-font-mono.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-geist-mono",
  display: "swap",
});

/**
 * The original <head>, emitted verbatim.
 *
 * Not a Next Metadata export and not next/script: this head contains an
 * `importmap` and a JSON-LD block. An import map must be parsed before the
 * module script that relies on it is fetched, and JSON-LD must never execute --
 * neither survives being appended dynamically. Letting the browser parse the
 * real head is the only faithful option.
 *
 * suppressHydrationWarning because third-party scripts in here mutate the head
 * before React hydrates, which is expected and not a bug to fix.
 */
function head() {
  return readFileSync(path.join(process.cwd(), "app", "head.html"), "utf8");
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // class="dark" drives the wallet cockpit's ElevenLabs Orb into its dark
    // variant (the Orb reads document.documentElement.classList "dark"). It has
    // no effect on the hero: nothing in the cloned markup or page scripts keys
    // off a `.dark` class. suppressHydrationWarning because the hero's scripts
    // (Webflow/GSAP) mutate <html> classes after load.
    <html lang="en" className="dark" suppressHydrationWarning>
      <head dangerouslySetInnerHTML={{ __html: head() }} suppressHydrationWarning />
      <body className={`${spaceGrotesk.variable} ${geistMono.variable}`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
