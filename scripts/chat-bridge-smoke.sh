#!/bin/sh
set -eu

base_url="${CHAT_BRIDGE_URL:-http://127.0.0.1:15821}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT INT TERM

curl -fsS "$base_url/api/health" > "$tmp_dir/health.json"
release="$(jq -er '.release.patchRelease' "$tmp_dir/health.json")"
desktop_version="$(jq -er '.release.desktopVersion' "$tmp_dir/health.json")"
renderer_base="$(jq -er '.renderer.basePath' "$tmp_dir/health.json")"

jq -e \
  --arg version "$desktop_version" \
  --arg release "$release" \
  --arg base "$renderer_base" \
  '.ok == true
    and .chatReady == true
    and .runtimeControlReady == true
    and .transport == "official-renderer-ipc"
    and .renderer.desktopVersion == $version
    and .renderer.patchRelease == $release
    and .renderer.basePath == $base' \
  "$tmp_dir/health.json" >/dev/null

curl -fsS "$base_url/" > "$tmp_dir/index.html"
grep -F "$renderer_base/assets/v1/index-" "$tmp_dir/index.html" >/dev/null
grep -F "/remote-preload.js?v=$release" "$tmp_dir/index.html" >/dev/null
if grep -E '[?&]claudesk-(edit|code|session|ask|entry)' "$tmp_dir/index.html" >/dev/null; then
  printf '%s\n' 'chat smoke: query-suffixed renderer module remains' >&2
  exit 1
fi

entry_path="$(sed -n 's/.*<script type="module"[^>]*src="\([^"]*index-[^"]*\.js\)".*/\1/p' "$tmp_dir/index.html")"
[ -n "$entry_path" ]
curl -fsS "$base_url$entry_path" > "$tmp_dir/entry.js"
grep -F 'duration:r=6500' "$tmp_dir/entry.js" >/dev/null

asset_list="$tmp_dir/renderer-assets.txt"
jq -er '(.renderer.files[].path), (.renderer.markers[].matches[].path)' \
  "$tmp_dir/health.json" | sort -u > "$asset_list"
[ -s "$asset_list" ]
asset_index=0
while IFS= read -r asset; do
  asset_index=$((asset_index + 1))
  curl -fsS "$base_url$renderer_base/$asset" > "$tmp_dir/renderer-$asset_index.js"
  node --check "$tmp_dir/renderer-$asset_index.js"
done < "$asset_list"
cat "$tmp_dir"/renderer-*.js > "$tmp_dir/renderer-patched.js"

for marker in \
  'ls=true' \
  'Ps=void 0!==ie||!!x?.rewind' \
  'if(Ce&&void 0!==ie){const e=ca(Q,n.uuid);' \
  'Fs=ls&&!Ts' \
  'editMessage:As&&!i?oa:void 0' \
  'isResend:!0' \
  'D=U&&!m&&!B&&u&&d&&l&&!e.sendFailed&&!R&&(M?v&&!_:v)' \
  'icon:"Edit","data-testid":"code-action-bar-edit"' \
  'a&&(0,eP.jsx)(UG,{onRewind:a,buttonVariant:c})' \
  '229===e.keyCode' \
  'Math.abs(e.timeStamp-zp)<500'; do
  grep -F "$marker" "$tmp_dir/renderer-patched.js" >/dev/null
done
if grep -F 'false,a&&(0,eP.jsx)(UG,{onRewind:a,buttonVariant:c})' \
  "$tmp_dir/renderer-patched.js" >/dev/null; then
  printf '%s\n' 'chat smoke: Code Edit remains hidden' >&2
  exit 1
fi

curl -fsS "$base_url/remote-preload.js?v=$release" > "$tmp_dir/remote-preload.js"
curl -fsS "$base_url/service-worker.js?v=$release" > "$tmp_dir/service-worker.js"
node --check "$tmp_dir/remote-preload.js"
grep -F "const RELEASE = \"$release\"" "$tmp_dir/service-worker.js" >/dev/null
grep -F 'const CACHE_NAME = `claude-official-remote-${RELEASE}`' \
  "$tmp_dir/service-worker.js" >/dev/null
grep -F 'eventStreamGeneration' "$tmp_dir/remote-preload.js" >/dev/null
if grep -F 'setInterval(connectEvents' "$tmp_dir/remote-preload.js" >/dev/null \
  || grep -F '/api/remote/files/reveal' "$tmp_dir/remote-preload.js" >/dev/null; then
  printf '%s\n' 'chat smoke: obsolete realtime or directory UI code remains' >&2
  exit 1
fi

curl -fsS "$base_url/api/chat/models" > "$tmp_dir/models.json"
curl -fsS "$base_url/api/chat/sessions" > "$tmp_dir/chat.json"
curl -fsS "$base_url/api/cowork/sessions" > "$tmp_dir/cowork.json"
jq -e '.ok == true and (.value | length) > 0' "$tmp_dir/models.json" >/dev/null
jq -e '.ok == true and ([.value[].sessionType] | all(. == "chat"))' "$tmp_dir/chat.json" >/dev/null
jq -e '.ok == true and ([.value[].sessionType] | all(. != "chat"))' "$tmp_dir/cowork.json" >/dev/null

if curl -fsS "$base_url/api/remote/files/reveal?path=%2Fworkspace" >/dev/null 2>&1; then
  printf '%s\n' 'chat smoke: removed directory reveal endpoint is still available' >&2
  exit 1
fi

jq -n \
  --arg version "$desktop_version" \
  --arg release "$release" \
  --arg renderer "$renderer_base" \
  --argjson chatCount "$(jq '.value|length' "$tmp_dir/chat.json")" \
  --argjson coworkCount "$(jq '.value|length' "$tmp_dir/cowork.json")" \
  '{ok:true,desktopVersion:$version,patchRelease:$release,renderer:$renderer,chatSessions:$chatCount,coworkSessions:$coworkCount}'
