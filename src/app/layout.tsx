import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GM-3D Chess — WebGPU Chess in Your Browser",
  description:
    "3D chess powered by WebGPU (Three.js) with an AI opponent, local hot-seat play and online multiplayer rooms.",
  keywords: ["chess", "WebGPU", "Three.js", "3D", "game", "AI", "multiplayer"],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "GM-3D Chess",
    description: "3D chess powered by WebGPU — play vs AI, locally, or online.",
    siteName: "GM-3D Chess",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
