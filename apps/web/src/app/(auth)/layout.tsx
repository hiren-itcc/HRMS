import { ShieldCheck } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-background">
      {/* Ambient gradient blobs — decorative only */}
      <div
        aria-hidden
        className="-top-40 -left-40 pointer-events-none absolute size-96 rounded-full bg-indigo-500/15 blur-3xl"
      />
      <div
        aria-hidden
        className="-bottom-40 -right-40 pointer-events-none absolute size-96 rounded-full bg-cyan-500/10 blur-3xl"
      />

      <div className="relative flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="gradient-primary flex size-10 items-center justify-center rounded-xl text-white shadow-indigo-500/30 shadow-lg">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="font-bold text-2xl tracking-tight">HRMS</span>
        </div>
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </div>
      </div>
      <p className="relative pb-6 text-center text-muted-foreground text-xs">
        © {new Date().getFullYear()} HRMS — internal use only
      </p>
    </div>
  );
}
