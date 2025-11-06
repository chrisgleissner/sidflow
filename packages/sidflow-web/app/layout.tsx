import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SIDFlow Control Panel",
  description: "Local web interface for SIDFlow - play, rate, and classify SID music",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased font-c64">
        {children}
      </body>
    </html>
  );
}
