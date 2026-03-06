import type { Metadata } from "next";
import { Geist, Geist_Mono, Source_Code_Pro } from "next/font/google";
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

const sourceCodePro = Source_Code_Pro({
  variable: "--font-source-code-pro",
  subsets: ["latin"],
});

// ✦ Change this number to adjust the RBase logo weight (200–700)
const CLASH_WEIGHT = "500";

const clashDisplay = localFont({
  src: "../public/fonts/ClashDisplay-Variable.woff2",
  variable: "--font-clash",
});

export const metadata: Metadata = {
  title: "R·Base - Agentic Data Science IDE",
  description: "In-browser R IDE with an integrated AI agent. Write R code, generate ggplot2 visualizations, and analyze datasets — zero setup required.",
  icons: {
    icon: "/r-logo-64.png",
    apple: "/r-logo-180.png",
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
            __html: `(function(){try{if(localStorage.getItem("sp-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}})()`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${sourceCodePro.variable} ${clashDisplay.variable} antialiased`}
        style={{ "--clash-weight": CLASH_WEIGHT } as React.CSSProperties}
      >
        {children}
      </body>
    </html>
  );
}
