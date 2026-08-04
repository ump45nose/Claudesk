#!/bin/sh

set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$project_dir"

container_name="claude-desktop"
web_port="${WEB_PORT:-15820}"

docker inspect "$container_name" \
    --format 'state={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} restart_count={{.RestartCount}}'

claude_version="$(docker exec "$container_name" \
    dpkg-query -W '-f=${Version}' claude-desktop)"
printf 'claude_version=%s\n' "$claude_version"

docker exec "$container_name" sh -c \
    'printf "managed_settings="; stat -c "%u:%g %a %F" /etc/claude-desktop/managed-settings.json; printf "managed_settings_app_read="; su-exec app test -r /etc/claude-desktop/managed-settings.json && echo yes || echo no; printf "kvm="; test -r /dev/kvm -a -w /dev/kvm && echo rw || echo unavailable; printf "vhost_vsock="; test -r /dev/vhost-vsock -a -w /dev/vhost-vsock && echo rw || echo unavailable; printf "virtiofsd="; test -x /usr/bin/virtiofsd && /usr/bin/virtiofsd --version || echo unavailable'

curl -fsS --max-time 10 "http://127.0.0.1:${web_port}/" >/dev/null
printf 'web=http://127.0.0.1:%s/ ok\n' "$web_port"

"$project_dir/scripts/cowork-bridge-smoke.sh"
