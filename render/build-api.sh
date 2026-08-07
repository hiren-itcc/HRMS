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

# Apply pending migrations before the new code starts serving.
#
# Nothing did this, so the schema only ever moved when somebody remembered to
# move it by hand. That is a slow failure: the build succeeds, the service goes
# live, and the first request touching a new table is the thing that reports
# it — as a Prisma error, to a user.
#
# `migrate deploy` applies pending migrations and nothing else. It never
# generates, never resets, and never prompts, so it is the one Prisma command
# that is safe without a person watching. It is also idempotent: a deploy with
# nothing pending is a no-op.
#
# The place for this is really Render's Pre-Deploy Command, which runs after a
# successful build and before the swap. That field, like the Build Command,
# cannot be edited after the service is created — so this runs at the end of
# the build instead. The distinction matters for a migration that would break
# the running version: this applies it while the old code is still serving.
# Additive changes are fine; a destructive one needs the expand-contract split
# (ship the code that tolerates both shapes first, drop the old column after).
pnpm --filter @hrms/api db:deploy
