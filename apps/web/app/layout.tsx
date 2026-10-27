import type { Metadata } from 'next';
import { Bricolage_Grotesque, DM_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Shell } from './Shell';

export const metadata: Metadata = { title: 'Cotizador EE' };

// Self-hosted at build time: no request to Google from the user's browser.
const sans = DM_Sans({ subsets: ['latin'], variable: '--font-sans' });
const display = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-display' });

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${sans.variable} ${display.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
