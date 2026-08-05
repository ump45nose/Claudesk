#!/bin/sh
set -eu

base_url="${CHAT_BRIDGE_URL:-http://127.0.0.1:15821}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT INT TERM

curl -fsS "$base_url/api/health" > "$tmp_dir/health.json"
curl -fsS "$base_url/api/chat/models" > "$tmp_dir/models.json"
curl -fsS "$base_url/api/chat/sessions" > "$tmp_dir/chat.json"
curl -fsS "$base_url/api/cowork/sessions" > "$tmp_dir/cowork.json"
curl -fsS "$base_url/" > "$tmp_dir/index.html"
grep -F '/remote-shell.css?v=20260804-1' "$tmp_dir/index.html" >/dev/null
grep -F '/fonts/AnthropicSerif-Text-Regular-CJK.otf?v=20260803-1' \
  "$tmp_dir/index.html" >/dev/null
curl -fsS "$base_url/remote-shell.css?v=20260804-1" > "$tmp_dir/remote-shell.css"
grep -F 'font-family: "Anthropic Serif Text CJK"' "$tmp_dir/remote-shell.css" >/dev/null
grep -F '.epitaxy-markdown:not(.epitaxy-file-prose)' "$tmp_dir/remote-shell.css" >/dev/null
curl -fsSI \
  "$base_url/fonts/AnthropicSerif-Text-Regular-CJK.otf?v=20260803-1" \
  > "$tmp_dir/font-headers.txt"
grep -Fi 'content-type: font/otf' "$tmp_dir/font-headers.txt" >/dev/null
grep -Fi 'cache-control: public, max-age=31536000, immutable' \
  "$tmp_dir/font-headers.txt" >/dev/null
grep -F 'session-title-split' "$tmp_dir/remote-shell.css" >/dev/null
grep -F '#cowork-title-slot' "$tmp_dir/remote-shell.css" >/dev/null
if grep -F 'html.claude-remote-mobile #cowork-title-slot' "$tmp_dir/remote-shell.css" >/dev/null; then
  printf '%s\n' 'chat smoke: title de-duplication is still mobile-only' >&2
  exit 1
fi
entry_path="$(sed -n 's/.*<script type="module"[^>]*src="\([^"]*\)".*/\1/p' "$tmp_dir/index.html")"
[ -n "$entry_path" ]
curl -fsS "$base_url$entry_path" > "$tmp_dir/entry.js"
grep -F 'onRetry:"chat"===F.sessionType?' "$tmp_dir/entry.js" >/dev/null
grep -F 'Ee=true' "$tmp_dir/entry.js" >/dev/null
grep -F 'Ke=Ee||(de?Re&&void 0!==J:!!Fs?.rewind)' "$tmp_dir/entry.js" >/dev/null
grep -F 'Je=Ee&&!Ye' "$tmp_dir/entry.js" >/dev/null
grep -F 'from"./shared-10-DEXHYEQf.js?claudesk-edit-actions=20260805-1"' \
  "$tmp_dir/entry.js" >/dev/null
grep -F 'from"./shared-17-YFu3JFq7.js?claudesk-session-menus=20260804-2"' \
  "$tmp_dir/entry.js" >/dev/null
grep -F 'from"./shared-12-kUZ_jZyi.js?claudesk-session-menus=20260804-2"' \
  "$tmp_dir/entry.js" >/dev/null
grep -F 'import("./cd377abb5-CvQ3GXS3.js?claudesk-code-actions=20260805-1")' \
  "$tmp_dir/entry.js" >/dev/null
grep -F 'from"./shared-1-3-6x7RKF.js?claudesk-toast-timeout=20260805-1"' \
  "$tmp_dir/entry.js" >/dev/null
if grep -F 'onRetry:xF,changeDisplayedConversationPath:yF' "$tmp_dir/entry.js" >/dev/null; then
  printf '%s\n' 'chat smoke: official retry callback was not patched' >&2
  exit 1
fi
node --check "$tmp_dir/entry.js"
curl -fsS \
  "$base_url/assets/v1/shared-10-DEXHYEQf.js?claudesk-edit-actions=20260805-1" \
  > "$tmp_dir/message-actions.js"
grep -F 'w?(!C||i)&&!_:!!e.parent_message_uuid' "$tmp_dir/message-actions.js" >/dev/null
if grep -F 'w?C&&i&&!_:!!e.parent_message_uuid' "$tmp_dir/message-actions.js" >/dev/null; then
  printf '%s\n' 'chat smoke: official mobile edit condition was not patched' >&2
  exit 1
fi
node --check "$tmp_dir/message-actions.js"
curl -fsS \
  "$base_url/assets/v1/shared-17-YFu3JFq7.js?claudesk-session-menus=20260804-2" \
  > "$tmp_dir/session-sidebar.js"
grep -F 'onArchive:T?void 0:N' "$tmp_dir/session-sidebar.js" >/dev/null
grep -F 'O=m?async()=>' "$tmp_dir/session-sidebar.js" >/dev/null
grep -F 'from"./shared-12-kUZ_jZyi.js?claudesk-session-menus=20260804-2"' \
  "$tmp_dir/session-sidebar.js" >/dev/null
node --check "$tmp_dir/session-sidebar.js"
curl -fsS \
  "$base_url/assets/v1/shared-12-kUZ_jZyi.js?claudesk-session-menus=20260804-2" \
  > "$tmp_dir/session-menu.js"
grep -F 'B=Boolean(!f&&m&&(!F||(A?F?q||P&&z:P||q:P&&(!F||z))))' \
  "$tmp_dir/session-menu.js" >/dev/null
grep -F 'delete-session-trigger' "$tmp_dir/session-menu.js" >/dev/null
node --check "$tmp_dir/session-menu.js"
curl -fsS \
  "$base_url/assets/v1/cd377abb5-CvQ3GXS3.js?claudesk-code-actions=20260805-1" \
  > "$tmp_dir/code-route.js"
grep -F 'from"./c5610fbe3-Bao3nWiP.js?claudesk-code-actions=20260805-1"' \
  "$tmp_dir/code-route.js" >/dev/null
grep -F 'from"./c360a9e1c-DrYIyI47.js?claudesk-code-actions=20260805-1"' \
  "$tmp_dir/code-route.js" >/dev/null
node --check "$tmp_dir/code-route.js"
curl -fsS \
  "$base_url/assets/v1/c5610fbe3-Bao3nWiP.js?claudesk-code-actions=20260805-1" \
  > "$tmp_dir/code-session.js"
grep -F 'from"./c360a9e1c-DrYIyI47.js?claudesk-code-actions=20260805-1"' \
  "$tmp_dir/code-session.js" >/dev/null
grep -F 'rewindV2' "$tmp_dir/code-session.js" >/dev/null
node --check "$tmp_dir/code-session.js"
curl -fsS \
  "$base_url/assets/v1/c360a9e1c-DrYIyI47.js?claudesk-code-actions=20260805-1" \
  > "$tmp_dir/code-actions.js"
grep -F 'icon:"Edit","data-testid":"code-action-bar-edit"' \
  "$tmp_dir/code-actions.js" >/dev/null
if grep -F 'icon:"ArrowUndoUp",disabled:void 0!==s,"aria-label":n.formatMessage({defaultMessage:"Rewind to here"' \
  "$tmp_dir/code-actions.js" >/dev/null; then
  printf '%s\n' 'chat smoke: official Code rewind icon was not patched' >&2
  exit 1
fi
node --check "$tmp_dir/code-actions.js"
curl -fsS \
  "$base_url/assets/v1/shared-1-3-6x7RKF.js?claudesk-toast-timeout=20260805-1" \
  > "$tmp_dir/toast-provider.js"
[ "$(grep -oF 'duration:r??6e3' "$tmp_dir/toast-provider.js" | wc -l)" -eq 5 ]
node --check "$tmp_dir/toast-provider.js"
for method in isHostLoopModeEnabled getDownloadStatus getRunningStatus; do
  curl -fsS \
    -H 'Content-Type: application/json' \
    -d "{\"surface\":\"ClaudeVM\",\"method\":\"$method\",\"args\":[],\"argsEncoding\":\"json-undefined-v1\"}" \
    "$base_url/api/remote/ipc" > "$tmp_dir/$method.json"
done

jq -e '.ok == true and .chatReady == true and .runtimeControlReady == true and .transport == "official-renderer-ipc"' \
  "$tmp_dir/health.json" >/dev/null
jq -e '.ok == true and (.value | length) > 0' "$tmp_dir/models.json" >/dev/null
jq -e '.ok == true and ([.value[].sessionType] | all(. == "chat"))' \
  "$tmp_dir/chat.json" >/dev/null
jq -e '.ok == true and ([.value[].sessionType] | all(. != "chat"))' \
  "$tmp_dir/cowork.json" >/dev/null

if [ -n "${CHAT_SESSION_ID:-}" ]; then
  encoded_id="$(jq -rn --arg value "$CHAT_SESSION_ID" '$value|@uri')"
  curl -fsS "$base_url/api/chat/sessions/$encoded_id" > "$tmp_dir/session.json"
  curl -fsS "$base_url/api/chat/sessions/$encoded_id/transcript" > "$tmp_dir/transcript.json"
  curl -fsS \
    -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg id "$CHAT_SESSION_ID" '{surface:"LocalAgentModeSessions",method:"getSession",args:[$id],argsEncoding:"json-undefined-v1"}')" \
    "$base_url/api/remote/ipc" > "$tmp_dir/remote-session.json"
  jq -e '.ok == true and .value.sessionType == "chat"' "$tmp_dir/session.json" >/dev/null
  jq -e '.ok == true and .value.sessionType == "chat"' "$tmp_dir/remote-session.json" >/dev/null
  jq -e '.ok == true and (.value | type) == "array"' "$tmp_dir/transcript.json" >/dev/null
fi

jq -n \
  --arg transport "$(jq -r .transport "$tmp_dir/health.json")" \
  --argjson models "$(jq '.value' "$tmp_dir/models.json")" \
  --argjson chatCount "$(jq '.value|length' "$tmp_dir/chat.json")" \
  --argjson coworkCount "$(jq '.value|length' "$tmp_dir/cowork.json")" \
  '{ok:true,transport:$transport,models:$models,chatSessions:$chatCount,coworkSessions:$coworkCount}'
