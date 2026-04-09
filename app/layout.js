export default function RootLayout({ children }) {
  return (
    <html>
      <body style={{margin:0, background:"#0b0b0b", color:"white", fontFamily:"Arial"}}>
        {children}
      </body>
    </html>
  );
}
