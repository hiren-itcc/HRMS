#!/usr/bin/env bash
#
# Render build for @hrms/api.
#
# This lives in the repo rather than in the service's Build Command field
# because Render's API offers no way to edit that field after creation — a
# one-character fix there means deleting and recreating the service, losing its
# URL and environment. As a script it is a normal commit.
#
set -euo pipefail

source "$(dirname "$0")/pnpm-env.sh"

# --prod=false because Render sets NODE_ENV=production for the runtime, and
# pnpm reads that as "skip devDependencies" — which here means no Nest CLI, no
# TypeScript and no Prisma, i.e. nothing that does the building.
pnpm install --frozen-lockfile --prod=false --filter @hrms/api...

pnpm --filter @hrms/api db:generate
pnpm --filter @hrms/types build
pnpm --filter @hrms/shared build
pnpm --filter @hrms/api build
