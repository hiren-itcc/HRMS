import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/providers';

/*
 * Fonts come from the coss theme, not next/font: it @imports
 * @fontsource-variable/inter and geist and sets --font-sans / --font-mono /
 * --font-heading itself. Loading Plus Jakarta here as well shipped a family
 * nothing referenced.
 */

export const metadata: Metadata = {
  title: {
    default: 'HRMS',
    template: '%s · HRMS',
  },
  description: 'Human Resource Management System',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
