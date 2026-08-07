#!/usr/bin/env bash
#
# Puts the pnpm named by package.json's `packageManager` on PATH.
#
# Two things ruled out corepack, in order:
#
#   Internal Error: EROFS: read-only file system, unlink '/usr/bin/pnpm'
#
# Render's image ships a pnpm there and corepack installs its shims beside its
# own binary, on a read-only layer. Redirecting the shims to a writable
# directory fixed that and produced the next one:
#
#   Error: EEXIST: rename '.corepack/v1/corepack-73-…' -> '.corepack/v1/pnpm/11.14.0'
#
# corepack unpacks to a temporary path and renames it into place, which fails
# when the destination survives from an earlier build in Render's restored
# cache. So corepack needs its cache to be either always warm or always cold,
# and Render guarantees neither.
#
# npm into a project-local prefix has no such state: it is the same operation
# whether the directory is empty or already populated.
#
set -euo pipefail

# One source of truth — `packageManager` is what the lockfile was written by,
# and --frozen-lockfile fails on a lockfileVersion pnpm does not recognise.
PNPM_VERSION="$(node -p "require('./package.json').packageManager.split('@')[1]")"
PNPM_PREFIX="${PWD}/.render-pnpm"

npm install --global --no-fund --no-audit --prefix "${PNPM_PREFIX}" "pnpm@${PNPM_VERSION}"
export PATH="${PNPM_PREFIX}/bin:${PATH}"

echo "==> node $(node --version), pnpm $(pnpm --version)"
