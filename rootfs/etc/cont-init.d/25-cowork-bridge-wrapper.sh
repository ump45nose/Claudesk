#!/bin/sh

set -eu

resources_dir=/usr/lib/claude-desktop/resources
official_asar="$resources_dir/official-app.asar"
active_asar="$resources_dir/app.asar"
state_dir=/var/lib/claude-cowork-bridge
patched_sha_file="$state_dir/patched.sha256"
patched_mode_file="$state_dir/patched.mode"
asar_cli=/opt/claude-cowork-bridge/asar/node_modules/@electron/asar/bin/asar.js
injection_dir=/opt/claude-cowork-bridge/injection/bridge-wrapper
package_patcher=/opt/claude-cowork-bridge/patch-package.mjs
renderer_preparer=/opt/claude-cowork-bridge/prepare-renderer.mjs
requested_mode="vm"
[ "${CLAUDE_COWORK_HOST_BASH:-0}" != "1" ] || requested_mode="container-host"

mkdir -p "$state_dir"
installed_version="$(dpkg-query -W -f='${Version}' claude-desktop)"
if [ "$installed_version" != "${CLAUDE_DESKTOP_VERSION:-}" ]; then
    printf '[cowork-wrapper] installed Desktop %s does not match fixed version %s\n' \
        "$installed_version" "${CLAUDE_DESKTOP_VERSION:-unset}" >&2
    exit 1
fi

prepare_renderer() {
    /usr/bin/node "$renderer_preparer"
}

active_sha="$(sha256sum "$active_asar" | awk '{ print $1 }')"
patched_sha=""
[ ! -f "$patched_sha_file" ] || patched_sha="$(cat "$patched_sha_file")"
patched_mode=""
[ ! -f "$patched_mode_file" ] || patched_mode="$(cat "$patched_mode_file")"

if [ "${COWORK_BRIDGE_ENABLED:-0}" != "1" ]; then
    if [ -n "$patched_sha" ] && [ "$active_sha" = "$patched_sha" ] && [ -f "$official_asar" ]; then
        mv -f "$official_asar" "$active_asar"
        rm -f "$patched_sha_file" "$patched_mode_file"
        printf '[cowork-wrapper] disabled; restored official app.asar\n'
    else
        printf '[cowork-wrapper] disabled; official app.asar already active\n'
    fi
    exit 0
fi

if [ -n "$patched_sha" ] && [ "$active_sha" = "$patched_sha" ]; then
    if [ "$patched_mode" = "$requested_mode" ]; then
        prepare_renderer
        printf '[cowork-wrapper] enabled; patched official app.asar already active (%s)\n' "$requested_mode"
        exit 0
    fi
    test -f "$official_asar"
    mv -f "$official_asar" "$active_asar"
    rm -f "$patched_sha_file" "$patched_mode_file"
    active_sha="$(sha256sum "$active_asar" | awk '{ print $1 }')"
fi

tmp_dir="$(mktemp -d /tmp/claude-cowork-patch.XXXXXX)"
trap 'rm -rf "$tmp_dir"' EXIT HUP INT TERM
extract_dir="$tmp_dir/app"
patched_asar="$tmp_dir/app.asar"

/usr/bin/node "$asar_cli" extract "$active_asar" "$extract_dir"
cp -a "$injection_dir" "$extract_dir/bridge-wrapper"
/usr/bin/node "$package_patcher" "$extract_dir/package.json"
/usr/bin/node "$asar_cli" pack "$extract_dir" "$patched_asar" --unpack '**/*.node'
test -s "$patched_asar"

cp -f "$active_asar" "$official_asar"
mv -f "$patched_asar" "$active_asar"
sha256sum "$active_asar" | awk '{ print $1 }' > "$patched_sha_file"
printf '%s\n' "$requested_mode" > "$patched_mode_file"
prepare_renderer
printf '[cowork-wrapper] enabled; official app.asar patched with Cowork IPC entry (%s)\n' "$requested_mode"
