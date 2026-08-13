import type { NextFunction, Request, Response } from 'express';
import { normaliseIp, runWithRequestContext } from '../request-context';

/**
 * Opens the request store around everything that handles the request.
 *
 * Registered in `AppModule` rather than `main.ts` on purpose. The test harness
 * builds the app straight from `AppModule` and replicates only two lines of the
 * bootstrap, so anything wired in `main.ts` is absent from every integration
 * test — and an audit trail that depends on which entrypoint started the
 * process is not one worth having.
 *
 * `req.ip` is only as good as `trust proxy`, which `main.ts:40` sets from
 * `TRUST_PROXY`. Left at 0 while directly exposed, `X-Forwarded-For` is ignored
 * and the socket address is used, which is the safe default: believing a
 * forgeable header would let a caller write whatever address it liked into the
 * audit log.
 */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  runWithRequestContext({ ip: normaliseIp(req.ip) }, next);
}
