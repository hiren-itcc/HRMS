#!/usr/bin/env bash
#
# Render build for @hrms/web. See build-api.sh for why this is a script.
#
# NEXT_PUBLIC_API_URL must be set as a service environment variable, not just
# at runtime: Next inlines NEXT_PUBLIC_* into the client bundle at build time,
# so a value supplied only when the server starts never reaches the browser and
# the app silently calls localhost:4000.
#
set -euo pipefail

source "$(dirname "$0")/pnpm-env.sh"

: "${NEXT_PUBLIC_API_URL:?must be set at build time — Next inlines it into the bundle}"
echo "==> building against API ${NEXT_PUBLIC_API_URL}"

pnpm install --frozen-lockfile --prod=false --filter @hrms/web...

# @hrms/ui is not built: next.config.ts lists it in transpilePackages, so Next
# compiles it from source along with the app.
pnpm --filter @hrms/types build
pnpm --filter @hrms/shared build
pnpm --filter @hrms/web build
