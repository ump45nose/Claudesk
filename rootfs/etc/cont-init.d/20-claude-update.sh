#!/bin/sh

set -u

if [ "${CLAUDE_UPDATE_ON_START:-1}" != "1" ]; then
    printf '[claude-update] startup update check disabled\n'
    exit 0
fi

timeout_seconds="${CLAUDE_UPDATE_TIMEOUT_SECONDS:-300}"
installed_before="$(dpkg-query -W -f='${Version}' claude-desktop 2>/dev/null || printf 'missing')"

printf '[claude-update] installed version before check: %s\n' "$installed_before"

if ! timeout "$timeout_seconds" apt-get update \
    -o Acquire::Retries=3 \
    -o DPkg::Lock::Timeout=60; then
    printf '[claude-update] WARNING: APT index refresh failed; keeping %s\n' \
        "$installed_before" >&2
    exit 0
fi

candidate="$(apt-cache policy claude-desktop \
    | awk '/Candidate:/ { print $2; exit }')"
printf '[claude-update] signed repository candidate: %s\n' "${candidate:-unknown}"

if ! timeout "$timeout_seconds" env DEBIAN_FRONTEND=noninteractive \
    apt-get install -y --only-upgrade \
    -o DPkg::Lock::Timeout=60 \
    claude-desktop; then
    printf '[claude-update] WARNING: upgrade failed; attempting installed version\n' >&2
    exit 0
fi

installed_after="$(dpkg-query -W -f='${Version}' claude-desktop 2>/dev/null || printf 'missing')"
printf '[claude-update] installed version after check: %s\n' "$installed_after"

rm -rf /var/lib/apt/lists/*
exit 0
