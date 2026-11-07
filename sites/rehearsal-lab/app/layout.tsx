import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rehearsal GPU Lab",
  description: "Shared local model testing for the Rehearsal team.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
