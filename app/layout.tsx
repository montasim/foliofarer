import type { Metadata, Viewport } from "next"
import { Barlow_Condensed, Geist } from "next/font/google"

import "./globals.css"

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" })

const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-journey-display",
})

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: "3D Journey | Montasim",
  description:
    "Walk through Montasim's code-authored professional journey, with the complete Atlas and Passport available inside the world.",
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
