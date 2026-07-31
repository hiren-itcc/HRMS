import { PageTransition } from '@/components/motion';

/** Remounts per navigation — every dashboard page fades/slides in. */
export default function Template({ children }: { children: React.ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
