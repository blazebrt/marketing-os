import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lakmé Marketing OS',
  description: 'Private marketing operations for Lakmé Salon Rajajipuram',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
