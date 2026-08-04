import { CalendarCheck, ClipboardList, ShieldCheck, Users } from 'lucide-react';
import { AuthIllustration } from '@/features/auth/components/auth-illustration';

const HIGHLIGHTS = [
  {
    icon: Users,
    label: 'People',
    hint: 'Records, structure and reporting lines',
  },
  {
    icon: CalendarCheck,
    label: 'Attendance',
    hint: 'Clock in, corrections and approvals',
  },
  {
    icon: ClipboardList,
    label: 'Leave',
    hint: 'Balances, requests and holidays',
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      {/*
       * Brand panel. Hidden below lg so a phone gets the form immediately
       * rather than a screen of decoration to scroll past.
       */}
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-foreground lg:flex lg:w-[46%] lg:flex-col lg:justify-between xl:w-1/2">
        <div
          aria-hidden
          className="-top-32 -left-24 pointer-events-none absolute size-96 animate-float rounded-full bg-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="-right-24 -bottom-40 pointer-events-none absolute size-96 animate-float-delayed rounded-full bg-info/15 blur-3xl"
        />

        <div className="relative flex items-center gap-2.5 p-10">
          <span className="gradient-primary flex size-10 items-center justify-center rounded-xl text-white shadow-lg">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="font-bold text-sidebar-accent-foreground text-xl tracking-tight">
            HRMS
          </span>
        </div>

        <div className="relative flex flex-1 flex-col justify-center gap-10 px-10 pb-6">
          <AuthIllustration className="mx-auto w-full max-w-md text-sidebar-accent-foreground" />

          <div className="space-y-5">
            <h2 className="max-w-sm text-balance text-sidebar-accent-foreground">
              Everything your team needs, in one workspace.
            </h2>
            <ul className="grid gap-3 sm:grid-cols-3">
              {HIGHLIGHTS.map((item) => (
                <li key={item.label} className="flex items-start gap-2.5">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                    <item.icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-sidebar-accent-foreground text-sm">
                      {item.label}
                    </span>
                    <span className="block text-sidebar-foreground/70 text-xs">{item.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className="relative p-10 pt-0 text-sidebar-foreground/60 text-xs">
          © {new Date().getFullYear()} HRMS
        </p>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 py-10 sm:px-8">
        {/*
         * Mobile background. The brand panel is hidden below lg, which left a
         * phone looking at a flat colour with a form floating on it — so the
         * same art appears here instead, heavily dimmed and behind everything.
         *
         * aria-hidden and no label: the desktop copy is the one that carries
         * the description, and two of them would announce it twice.
         */}
        <div aria-hidden className="pointer-events-none absolute inset-0 lg:hidden">
          <div className="-top-24 -left-20 absolute size-72 animate-float rounded-full bg-primary/20 blur-3xl" />
          <div className="-right-20 -bottom-28 absolute size-72 animate-float-delayed rounded-full bg-info/15 blur-3xl" />
          <AuthIllustration className="-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2 w-[130%] max-w-none text-foreground opacity-[0.07] dark:opacity-[0.10]" />
        </div>

        {/* Mobile brand — the panel carrying it is hidden at this width */}
        <div className="relative mb-8 flex items-center gap-2.5 lg:hidden">
          <span className="gradient-primary flex size-10 items-center justify-center rounded-xl text-white shadow-lg">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="font-bold text-xl tracking-tight">HRMS</span>
        </div>

        <div className="relative w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </div>

        <p className="relative mt-10 text-center text-muted-foreground text-xs lg:hidden">
          © {new Date().getFullYear()} HRMS
        </p>
      </main>
    </div>
  );
}
