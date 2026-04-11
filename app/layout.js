export const metadata = {
  title: "TDT Scanner",
  description: "Market-aware averages with home/away guidance",
  manifest: "/manifest.json",
  themeColor: "#22c55e"
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#22c55e",
};

import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
