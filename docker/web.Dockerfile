# HRMS Web — multi-stage build with Next standalone output
FROM node:24-alpine AS base
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter @hrms/web...
COPY packages/ packages/
COPY apps/web/ apps/web/
RUN pnpm --filter @hrms/types build \
  && pnpm --filter @hrms/shared build \
  && pnpm --filter @hrms/web build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
# Next's standalone server reads PORT (defaults to 3000)
ENV PORT=5173
RUN addgroup -S hrms && adduser -S hrms -G hrms
WORKDIR /app
COPY --from=build --chown=hrms:hrms /repo/apps/web/.next/standalone ./
COPY --from=build --chown=hrms:hrms /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=hrms:hrms /repo/apps/web/public ./apps/web/public
USER hrms
EXPOSE 5173
CMD ["node", "apps/web/server.js"]
