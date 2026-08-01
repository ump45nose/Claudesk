#!/bin/sh

set -eu

export HOME=/config
export XDG_CONFIG_HOME=/config/.config
export XDG_CACHE_HOME=/config/.cache
export ELECTRON_OZONE_PLATFORM_HINT=x11

mkdir -p \
    "$XDG_CONFIG_HOME" \
    "$XDG_CACHE_HOME" \
    /config/log \
    /workspace

# Electron's singleton links live in the persistent profile.  A container
# replacement gives the process namespace a new lifetime, so a lock pointing
# at the previous container can collide with an unrelated reused PID and make
# the official app exit immediately.  These links contain no user data.
rm -f \
    /config/.config/Claude/SingletonCookie \
    /config/.config/Claude/SingletonLock \
    /config/.config/Claude/SingletonSocket \
    /config/.config/Claude-3p/SingletonCookie \
    /config/.config/Claude-3p/SingletonLock \
    /config/.config/Claude-3p/SingletonSocket

installed_version="$(dpkg-query -W -f='${Version}' claude-desktop 2>/dev/null || printf 'unknown')"
printf '[claude-start] launching official Claude Desktop %s\n' "$installed_version"

set -- \
    --ozone-platform=x11 \
    --disable-setuid-sandbox \
    --password-store=basic

if [ "${COWORK_BRIDGE_ENABLED:-0}" = "1" ]; then
    printf '[claude-start] Cowork IPC wrapper enabled on loopback:%s\n' \
        "${COWORK_BRIDGE_INTERNAL_PORT:-9222}"
fi

exec /usr/bin/claude-desktop "$@"
