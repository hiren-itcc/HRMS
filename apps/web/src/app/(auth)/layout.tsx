import { ShieldCheck } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-10">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <span className="font-bold text-2xl tracking-tight">HRMS</span>
        </div>
        <div className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-2 duration-300">
          {children}
        </div>
      </div>
      <p className="pb-6 text-center text-muted-foreground text-xs">
        © {new Date().getFullYear()} HRMS — internal use only
      </p>
    </div>
  );
}
