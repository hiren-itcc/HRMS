import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';

/**
 * The public shell.
 *
 * Its own route group because it must not inherit the dashboard's: no sidebar,
 * no `SessionProvider`, no permission checks, and nothing that assumes a signed
 * in user. A visitor here has no account and may never want one.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/careers" className="flex items-center gap-2.5 font-semibold">
            <BrandMark />
            Careers
          </Link>
          {/* The only way back in, for somebody who works here and landed on a
              job advert a colleague sent them. */}
          <Link href="/login" className="text-muted-foreground text-sm hover:underline">
            Employee sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10">{children}</main>

      <footer className="border-t">
        <div className="mx-auto max-w-5xl px-4 py-6 text-muted-foreground text-xs">
          Applications are read by the hiring team. We keep your details only for this role and
          others you apply to.
        </div>
      </footer>
    </div>
  );
}
