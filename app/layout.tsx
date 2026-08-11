import type { Metadata, Viewport } from "next"
import { Barlow_Condensed, Geist } from "next/font/google"

import "./globals.css"

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" })

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-journey-display",
})

const appUrl =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://foliofarer.netlify.app"

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "Foliofarer | Montasim",
  description:
    "Explore Montasim's code-authored professional world through Foliofarer, with a complete career Atlas and device-local Passport.",
  alternates: { canonical: "/" },
  icons: {
    icon: [{ url: "/favicon.ico" }, { url: "/icon.png", type: "image/png" }],
  },
}

export const viewport: Viewport = {
  themeColor: "#5ea9e1",
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  )
}
