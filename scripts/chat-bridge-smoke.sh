#!/bin/sh
set -eu

base_url="${CHAT_BRIDGE_URL:-http://127.0.0.1:15821}"
tmp_dir="$(mktemp -d)"
trap 'rm -rf -- "$tmp_dir"' EXIT INT TERM

curl -fsS "$base_url/api/health" > "$tmp_dir/health.json"
curl -fsS "$base_url/api/chat/models" > "$tmp_dir/models.json"
curl -fsS "$base_url/api/chat/sessions" > "$tmp_dir/chat.json"
curl -fsS "$base_url/api/cowork/sessions" > "$tmp_dir/cowork.json"
for method in isHostLoopModeEnabled getDownloadStatus getRunningStatus; do
  curl -fsS \
    -H 'Content-Type: application/json' \
    -d "{\"surface\":\"ClaudeVM\",\"method\":\"$method\",\"args\":[],\"argsEncoding\":\"json-undefined-v1\"}" \
    "$base_url/api/remote/ipc" > "$tmp_dir/$method.json"
done

jq -e '.ok == true and .chatReady == true and .runtimeControlReady == true and .transport == "official-renderer-ipc"' \
  "$tmp_dir/health.json" >/dev/null
jq -e '.ok == true and (.value | type) == "boolean"' \
  "$tmp_dir/isHostLoopModeEnabled.json" >/dev/null
jq -e '.ok == true and (.value | type) == "string"' \
  "$tmp_dir/getDownloadStatus.json" >/dev/null
jq -e '.ok == true and (.value | type) == "string"' \
  "$tmp_dir/getRunningStatus.json" >/dev/null
jq -e '.ok == true and (.value | length) > 0' "$tmp_dir/models.json" >/dev/null
jq -e '.ok == true and ([.value[].sessionType] | all(. == "chat"))' \
  "$tmp_dir/chat.json" >/dev/null
jq -e '.ok == true and ([.value[].sessionType] | all(. != "chat"))' \
  "$tmp_dir/cowork.json" >/dev/null

if [ -n "${CHAT_SESSION_ID:-}" ]; then
  encoded_id="$(jq -rn --arg value "$CHAT_SESSION_ID" '$value|@uri')"
  curl -fsS "$base_url/api/chat/sessions/$encoded_id" > "$tmp_dir/session.json"
  curl -fsS "$base_url/api/chat/sessions/$encoded_id/transcript" > "$tmp_dir/transcript.json"
  jq -e '.ok == true and .value.sessionType == "chat"' "$tmp_dir/session.json" >/dev/null
  jq -e '.ok == true and (.value | type) == "array"' "$tmp_dir/transcript.json" >/dev/null
fi

jq -n \
  --arg transport "$(jq -r .transport "$tmp_dir/health.json")" \
  --argjson models "$(jq '.value' "$tmp_dir/models.json")" \
  --argjson chatCount "$(jq '.value|length' "$tmp_dir/chat.json")" \
  --argjson coworkCount "$(jq '.value|length' "$tmp_dir/cowork.json")" \
  '{ok:true,transport:$transport,models:$models,chatSessions:$chatCount,coworkSessions:$coworkCount}'
