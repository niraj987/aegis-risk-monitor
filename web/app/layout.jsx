import "./globals.css";
import "./polish.css";

export const metadata = {
  title: "Aegis · Portfolio Risk Monitor",
  description:
    "Near-real-time portfolio risk monitoring with VaR, Expected Shortfall, drawdowns, anomaly detection, scenario stress tests and a human-in-the-loop review queue.",
  icons: { icon: "/favicon.svg" },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7f6f2",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
