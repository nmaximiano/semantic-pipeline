import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ✦ Change this number to adjust the Kwartz logo weight (200–700)
const CLASH_WEIGHT = "500";

const clashDisplay = localFont({
  src: "../public/fonts/ClashDisplay-Variable.woff2",
  variable: "--font-clash",
});

export const metadata: Metadata = {
  title: "Kwartz - AI for Data",
  description: "An AI agent that works with your data — analyze, transform, and enrich datasets through conversation.",
  icons: {
    icon: "/favicon.png?v=4",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("sp-theme");if(t==="dark"||(!t&&matchMedia("(prefers-color-scheme:dark)").matches))document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${clashDisplay.variable} antialiased`}
        style={{ "--clash-weight": CLASH_WEIGHT } as React.CSSProperties}
      >
        {children}
      </body>
    </html>
  );
}
