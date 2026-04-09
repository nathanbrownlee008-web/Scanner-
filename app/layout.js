export const metadata = {
  title: "Value Scanner Phase 6.2",
  description: "Market-aware averages with home/away guidance"
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
