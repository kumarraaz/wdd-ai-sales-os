import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WDD AI SALES OS — Turn the Internet Into Your Sales Pipeline",
  description:
    "Discover qualified prospects, understand their business, personalize outreach and manage your entire sales workflow with AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0D1B2A] text-white antialiased">{children}</body>
    </html>
  );
}
