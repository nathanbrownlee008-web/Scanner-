export const metadata = {
  title: "Value Scanner",
  description: "Market-by-market value scanner"
};

import "./globals.css";

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
