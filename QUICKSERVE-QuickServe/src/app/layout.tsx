import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Providers } from "@/components/providers/SessionProvider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "QuickServe — Multi-Restaurant Order Management",
  description: "Enterprise-grade order management system for restaurants. Manage orders, menus, tables, and analytics with AI-powered insights.",
  keywords: ["restaurant", "order management", "POS", "kitchen display", "Nepal"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
