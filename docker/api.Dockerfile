# HRMS API — multi-stage build (docs/10-engineering-standards.md §CI/CD)
FROM node:24-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --filter @hrms/api...
COPY packages/ packages/
COPY apps/api/ apps/api/
RUN pnpm --filter @hrms/api db:generate \
  && pnpm --filter @hrms/types build \
  && pnpm --filter @hrms/shared build \
  && pnpm --filter @hrms/api build \
  && pnpm --filter @hrms/api --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
RUN addgroup -S hrms && adduser -S hrms -G hrms
WORKDIR /app
COPY --from=build --chown=hrms:hrms /out/ ./
COPY --from=build --chown=hrms:hrms /repo/apps/api/dist ./dist
COPY --from=build --chown=hrms:hrms /repo/apps/api/prisma ./prisma
# Supabase's root CA, pinned by DATABASE_URL's sslrootcert. The path there is
# relative to WORKDIR, so this must land at /app/certs or the API cannot open a
# verified connection and refuses to start.
COPY --from=build --chown=hrms:hrms /repo/apps/api/certs ./certs
USER hrms
EXPOSE 4000
CMD ["node", "dist/main.js"]
