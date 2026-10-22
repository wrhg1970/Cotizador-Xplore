import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Shell } from './Shell';

export const metadata: Metadata = { title: 'Cotizador EE' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
