import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Tennis-Turnier',
  description: 'Gruppenphase, Tabelle und KO-Runde für das Tennis-Turnier'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
