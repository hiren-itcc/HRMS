import type { Metadata } from 'next';
import './globals.css';
import { COLOR_THEME_SCRIPT } from '@/components/color-theme';
import { Providers } from '@/components/providers';

/*
 * Fonts come from the stylesheet, not next/font: packages/ui @imports the
 * Fontsource families and sets --font-sans / --font-mono / --font-heading from
 * them, so a theme can move the stack at runtime. Plus Jakarta is imported
 * there too — it is the second family, carried by two of the six themes.
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
      <head>
        {/*
          Sets data-theme from localStorage before the first paint, the same
          trick next-themes uses for the dark class. Without it, anyone on a
          non-default theme sees a frame of terracotta on every navigation —
          and it is the kind of regression nobody notices in a test.
        */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: a literal built at module scope, no user input */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
