import { redirect } from 'next/navigation';

/**
 * The root is not a destination. proxy.ts normally redirects it before this
 * renders (to /dashboard when a session marker is present, /login otherwise);
 * this is the fallback for any request that reaches the app directly.
 */
export default function Home() {
  redirect('/login');
}
