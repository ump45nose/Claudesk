#!/bin/sh

set -eu

web_port="${COWORK_WEB_PORT:-15821}"
base_url="http://127.0.0.1:${web_port}"

health="$(curl -fsS --max-time 10 "$base_url/api/health")"
printf '%s' "$health" | jq -e \
    '.ok == true and .coworkReady == true and (has("destructiveMethodsEnabled") | not)' \
    >/dev/null

sessions="$(curl -fsS --max-time 15 "$base_url/api/cowork/sessions")"
printf '%s' "$sessions" | jq -e '.ok == true and (.value | type == "array")' >/dev/null

session_count="$(printf '%s' "$sessions" | jq '.value | length')"
printf 'cowork_bridge=%s ok\n' "$base_url"
printf 'cowork_sessions=%s\n' "$session_count"
