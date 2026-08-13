import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The bits of the current HTTP request that a service may need but should not
 * have to be handed.
 *
 * This exists for exactly one problem: `AuditLog.ip`. The column has always
 * been there and `audit.service.ts` has always returned it, but only the auth
 * path ever filled it in — sign-in, sign-out and refresh-reuse rows, which
 * build their insert by hand from a `RequestMeta` they already hold. Every
 * business mutation went through `auditMutation`, which is called from 164
 * places, none of which have a `Request`. Threading one through every service
 * signature to reach a column that only the audit writer reads would be a large
 * change to a lot of code that does not care.
 *
 * So it is ambient instead, which is a real trade and worth naming: ambient
 * state is invisible at the call site. Two things keep it honest — the store
 * holds only what a request *is* (never what it may do, so nothing can grant
 * itself permissions through here), and `auditMutation` still accepts an
 * explicit IP that wins, so a caller that knows better is never overruled.
 *
 * Outside a request — the seeder, a CLI, the lifecycle tick when it is not on
 * a request — there is no store and the IP is null, which is the truth.
 */
export interface RequestContext {
  /** The client address, already normalised. Null when it cannot be determined. */
  ip: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Runs `fn` with `context` visible to everything it awaits. */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current request's context, or undefined outside one. */
export function currentRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Express reports an IPv4 client over a dual-stack socket as `::ffff:127.0.0.1`
 * — correct, and unreadable in an audit table next to `203.0.113.7`. Strips the
 * mapping prefix and nothing else: a real IPv6 address is left alone, because
 * rewriting it would be a lie about where the request came from.
 *
 * Whatever Express gives us is kept as-is otherwise. This does not validate —
 * the value is written for a human to read, not parsed, and a malformed address
 * recorded verbatim is more useful than a null.
 */
export function normaliseIp(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  return mapped ? (mapped[1] as string) : trimmed;
}
