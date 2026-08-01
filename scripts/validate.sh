#!/bin/sh

set -eu

project_dir="$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_dir"

find bridge bridge-wrapper rootfs/opt \
    -type f \( -name '*.js' -o -name '*.mjs' -o -name '*.cjs' \) \
    -exec node --check {} \;

find rootfs scripts -type f -name '*.sh' -exec sh -n {} \;

jq -e . \
    bridge/public/manifest.webmanifest \
    bridge-wrapper/package.json \
    security/claude-desktop.json \
    >/dev/null

if command -v shellcheck >/dev/null 2>&1; then
    find rootfs scripts -type f -name '*.sh' -print0 \
        | xargs -0 shellcheck
else
    printf '%s\n' 'validate: shellcheck is unavailable; skipped shell lint' >&2
fi

if docker compose version >/dev/null 2>&1; then
    CLAUDE_ENV_FILE=.env.example \
    CLAUDE_GATEWAY_BASE_URL=https://gateway.example.invalid \
    CLAUDE_GATEWAY_API_KEY=validation-placeholder \
    CLAUDE_INFERENCE_MODELS_JSON='["claude-validation-model"]' \
        docker compose config --quiet
else
    printf '%s\n' 'validate: Docker Compose is unavailable; skipped Compose validation' >&2
fi

printf '%s\n' 'validate: all available checks passed'
