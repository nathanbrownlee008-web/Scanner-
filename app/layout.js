export const metadata = {
  title: "Value Scanner Phase 4",
  description: "Responsive scanner with saved data and better mobile cards"
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
