import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Voice Caption Translator",
  description: "Real-time local voice captions and translation"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
