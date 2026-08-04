#!/usr/bin/env bash
#
# Puts the pnpm pinned by package.json's `packageManager` on PATH.
#
# `corepack enable` on its own fails on Render:
#
#   Internal Error: EROFS: read-only file system, unlink '/usr/bin/pnpm'
#
# The image already ships a pnpm there and corepack's default is to replace the
# shim next to its own binary, which is on a read-only layer. Installing the
# shims into the build workspace instead sidesteps it, and has the better
# property anyway: the pnpm that runs is the one the lockfile was written by,
# rather than whichever version the base image happens to carry. That matters
# because --frozen-lockfile fails outright on a lockfileVersion it does not
# recognise.
#
set -euo pipefail

# Non-interactive: without this corepack prompts before downloading, and a
# prompt in a build with no tty is a hang, not an error.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export COREPACK_HOME="${PWD}/.corepack"

mkdir -p "${PWD}/.pnpm-bin"
corepack enable --install-directory "${PWD}/.pnpm-bin"
export PATH="${PWD}/.pnpm-bin:${PATH}"

echo "==> node $(node --version), pnpm $(pnpm --version)"
