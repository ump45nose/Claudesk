#!/bin/sh

set -eu

base_url="${CLAUDE_GATEWAY_BASE_URL:-}"
api_key="${CLAUDE_GATEWAY_API_KEY:-}"
auth_scheme="${CLAUDE_GATEWAY_AUTH_SCHEME:-bearer}"
models_json="${CLAUDE_INFERENCE_MODELS_JSON:-}"
remote_gateway_settings="${CLAUDE_REMOTE_GATEWAY_SETTINGS:-0}"
remote_code_actions="${CLAUDE_REMOTE_CODE_ACTIONS:-0}"
allowed_egress_hosts_json="${CLAUDE_EGRESS_ALLOWED_HOSTS_JSON:-}"
vm_memory_gb="${CLAUDE_COWORK_VM_MEMORY_GB:-2}"
vm_cpu_count="${CLAUDE_COWORK_VM_CPU_COUNT:-1}"

case "$vm_memory_gb" in
    1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16)
        ;;
    *)
        printf '[claude-config] ERROR: CLAUDE_COWORK_VM_MEMORY_GB must be an integer from 1 to 16\n' >&2
        exit 1
        ;;
esac

case "$vm_cpu_count" in
    1|2|3|4|5|6|7|8)
        ;;
    *)
        printf '[claude-config] ERROR: CLAUDE_COWORK_VM_CPU_COUNT must be an integer from 1 to 8\n' >&2
        exit 1
        ;;
esac

case "$remote_gateway_settings" in
    0|1)
        ;;
    *)
        printf '[claude-config] ERROR: CLAUDE_REMOTE_GATEWAY_SETTINGS must be 0 or 1\n' >&2
        exit 1
        ;;
esac

case "$remote_code_actions" in
    0|1)
        ;;
    *)
        printf '[claude-config] ERROR: CLAUDE_REMOTE_CODE_ACTIONS must be 0 or 1\n' >&2
        exit 1
        ;;
esac

if [ -z "$base_url" ]; then
    printf '[claude-config] ERROR: CLAUDE_GATEWAY_BASE_URL is required\n' >&2
    exit 1
fi

if [ -z "$api_key" ]; then
    printf '[claude-config] ERROR: CLAUDE_GATEWAY_API_KEY is required\n' >&2
    exit 1
fi

case "$auth_scheme" in
    bearer|x-api-key)
        ;;
    *)
        printf '[claude-config] ERROR: auth scheme must be bearer or x-api-key\n' >&2
        exit 1
        ;;
esac

if [ -z "$models_json" ] || ! printf '%s' "$models_json" \
    | jq -e '
        type == "array"
        and length > 0
        and all(.[];
            (type == "string" and length > 0)
            or
            (type == "object" and (.name | type == "string" and length > 0))
        )
    ' >/dev/null; then
    printf '[claude-config] ERROR: CLAUDE_INFERENCE_MODELS_JSON must contain model names or model objects with a name\n' >&2
    exit 1
fi

if [ -n "$allowed_egress_hosts_json" ] && ! printf '%s' "$allowed_egress_hosts_json" \
    | jq -e '
        type == "array"
        and length > 0
        and all(.[]; type == "string" and length > 0)
    ' >/dev/null; then
    printf '[claude-config] ERROR: CLAUDE_EGRESS_ALLOWED_HOSTS_JSON must be a non-empty JSON string array\n' >&2
    exit 1
fi
if [ -z "$allowed_egress_hosts_json" ]; then
    allowed_egress_hosts_json=null
fi

if [ -L /etc/claude-desktop ]; then
    printf '[claude-config] ERROR: /etc/claude-desktop must not be a symlink\n' >&2
    exit 1
fi

install -d -o root -g root -m 0755 /etc/claude-desktop
tmp_file="$(mktemp /etc/claude-desktop/.managed-settings.XXXXXX)"
developer_tmp=""
app_config_tmp=""
legacy_app_config_tmp=""
trap 'rm -f "$tmp_file" "$developer_tmp" "$app_config_tmp" "$legacy_app_config_tmp"' EXIT HUP INT TERM

jq -n \
    --arg base_url "$base_url" \
    --arg api_key "$api_key" \
    --arg auth_scheme "$auth_scheme" \
    --arg code "$remote_code_actions" \
    --arg remote "$remote_gateway_settings" \
    --argjson models "$models_json" \
    --argjson allowed_egress_hosts "$allowed_egress_hosts_json" \
    '({
        inferenceProvider: "gateway",
        inferenceGatewayBaseUrl: $base_url,
        inferenceGatewayApiKey: $api_key,
        inferenceGatewayAuthScheme: $auth_scheme,
        inferenceCredentialKind: "static",
        inferenceModels: $models,
        disableDeploymentModeChooser: ($remote == "0"),
        chatTabEnabled: true,
        coworkTabEnabled: true,
        isClaudeCodeForDesktopEnabled: ($code == "1")
    } + if $allowed_egress_hosts == null then {} else {coworkEgressAllowedHosts: $allowed_egress_hosts} end)' > "$tmp_file"

# The official Desktop builds its top-level Developer menu only when the
# official user-data setting allowDevTools is enabled.  Keep that setting tied
# to the same explicit opt-in that exposes the writable remote Gateway editor;
# preserve any other official developer settings already present.
user_id="${USER_ID:-1000}"
group_id="${GROUP_ID:-1000}"
user_data_dir="/config/.config/Claude-3p"
developer_settings="$user_data_dir/developer_settings.json"

install -d -o "$user_id" -g "$group_id" -m 0700 "$user_data_dir"
if [ -L "$developer_settings" ]; then
    printf '[claude-config] ERROR: developer settings must not be a symlink\n' >&2
    exit 1
fi

developer_tmp="$(mktemp "$user_data_dir/.developer-settings.XXXXXX")"
if [ -f "$developer_settings" ]; then
    jq --argjson enabled "$remote_gateway_settings" \
        '. + {allowDevTools: ($enabled == 1)}' \
        "$developer_settings" > "$developer_tmp"
else
    jq -n --argjson enabled "$remote_gateway_settings" \
        '{allowDevTools: ($enabled == 1)}' > "$developer_tmp"
fi
install -o "$user_id" -g "$group_id" -m 0600 \
    "$developer_tmp" "$developer_settings"
rm -f "$developer_tmp"
developer_tmp=""
printf '[claude-config] official Developer menu follows CLAUDE_REMOTE_GATEWAY_SETTINGS=%s\n' \
    "$remote_gateway_settings"

# These are official Desktop preferences consumed by the Linux VM startup
# path. The app's getAppConfigPath() resolves to claude_desktop_config.json and
# reads them from its `preferences` object. Merge there instead of patching
# QEMU arguments or the packaged application.
app_config="$user_data_dir/claude_desktop_config.json"
if [ -L "$app_config" ]; then
    printf '[claude-config] ERROR: app config must not be a symlink\n' >&2
    exit 1
fi
app_config_tmp="$(mktemp "$user_data_dir/.config.XXXXXX")"
if [ -f "$app_config" ]; then
    jq \
        --argjson memory_gb "$vm_memory_gb" \
        --argjson cpu_count "$vm_cpu_count" \
        '.preferences = ((.preferences // {}) + {
            vmMemoryGB: $memory_gb,
            vmCpuCount: $cpu_count,
            coworkScheduledTasksEnabled: true
        })
        | del(.vmMemoryGB, .vmCpuCount, .coworkScheduledTasksEnabled)' \
        "$app_config" > "$app_config_tmp"
else
    jq -n \
        --argjson memory_gb "$vm_memory_gb" \
        --argjson cpu_count "$vm_cpu_count" \
        '{preferences: {
            vmMemoryGB: $memory_gb,
            vmCpuCount: $cpu_count,
            coworkScheduledTasksEnabled: true
        }}' > "$app_config_tmp"
fi
install -o "$user_id" -g "$group_id" -m 0600 "$app_config_tmp" "$app_config"
rm -f "$app_config_tmp"
app_config_tmp=""

# Clean only the three fields that older revisions of this image mistakenly
# wrote to Electron's separate config.json state file. Preserve every other
# key, including any unrelated preferences that may be added in the future.
legacy_app_config="$user_data_dir/config.json"
if [ -f "$legacy_app_config" ] && [ ! -L "$legacy_app_config" ]; then
    legacy_app_config_tmp="$(mktemp "$user_data_dir/.legacy-config.XXXXXX")"
    jq '
        del(.vmMemoryGB, .vmCpuCount, .coworkScheduledTasksEnabled)
        | if (.preferences | type) == "object" then
            .preferences |= del(.vmMemoryGB, .vmCpuCount, .coworkScheduledTasksEnabled)
          else . end
        | if .preferences == {} then del(.preferences) else . end
    ' "$legacy_app_config" > "$legacy_app_config_tmp"
    install -o "$user_id" -g "$group_id" -m 0600 \
        "$legacy_app_config_tmp" "$legacy_app_config"
    rm -f "$legacy_app_config_tmp"
    legacy_app_config_tmp=""
fi
printf '[claude-config] Cowork VM constrained to %s GiB / %s vCPU; scheduled tasks enabled\n' \
    "$vm_memory_gb" "$vm_cpu_count"

if [ "$remote_gateway_settings" = "1" ]; then
    config_library="$user_data_dir/configLibrary"
    meta_file="$config_library/_meta.json"

    install -d -o "$user_id" -g "$group_id" -m 0700 \
        "$user_data_dir" "$config_library"

    if [ ! -e "$meta_file" ]; then
        config_id="$(sed -n '1p' /proc/sys/kernel/random/uuid)"
        config_file="$config_library/$config_id.json"
        meta_tmp="$(mktemp "$config_library/.meta.XXXXXX")"
        jq -n \
            --arg id "$config_id" \
            '{appliedId: $id, entries: [{id: $id, name: "Default"}]}' \
            > "$meta_tmp"
        install -o "$user_id" -g "$group_id" -m 0600 "$tmp_file" "$config_file"
        install -o "$user_id" -g "$group_id" -m 0600 "$meta_tmp" "$meta_file"
        rm -f "$meta_tmp"
        printf '[claude-config] seeded writable 3P configuration library from environment\n'
    else
        applied_id="$(jq -r '.appliedId // empty' "$meta_file")"
        case "$applied_id" in
            ????????-????-????-????-????????????)
                ;;
            *)
                printf '[claude-config] ERROR: existing configLibrary metadata has an invalid appliedId\n' >&2
                exit 1
                ;;
        esac
        if [ ! -f "$config_library/$applied_id.json" ]; then
            printf '[claude-config] ERROR: existing configLibrary applied configuration is missing\n' >&2
            exit 1
        fi
        if [ "$allowed_egress_hosts_json" != "null" ]; then
            egress_tmp="$(mktemp "$config_library/.egress.XXXXXX")"
            jq --argjson allowed_egress_hosts "$allowed_egress_hosts_json" \
                '. + {coworkEgressAllowedHosts: $allowed_egress_hosts} | del(.allowedEgressHosts)' \
                "$config_library/$applied_id.json" > "$egress_tmp"
            install -o "$user_id" -g "$group_id" -m 0600 \
                "$egress_tmp" "$config_library/$applied_id.json"
            rm -f "$egress_tmp"
            printf '[claude-config] applied explicit egress policy from environment\n'
        fi
        if [ "$remote_code_actions" = "1" ]; then
            code_tmp="$(mktemp "$config_library/.code.XXXXXX")"
            jq '. + {isClaudeCodeForDesktopEnabled: true}' \
                "$config_library/$applied_id.json" > "$code_tmp"
            install -o "$user_id" -g "$group_id" -m 0600 \
                "$code_tmp" "$config_library/$applied_id.json"
            rm -f "$code_tmp"
            printf '[claude-config] official Code surface enabled from environment\n'
        fi

        # `allowedPluginMarketplaces` is a provisioning list. The current
        # Desktop retries `plugin marketplace add` on every launch and reports
        # already-present clones as load failures. Once every configured entry
        # exists in the official persistent marketplace registry, remove the
        # one-shot list and let the native registry remain the source of truth.
        configured_marketplace_count="$(jq '.allowedPluginMarketplaces // [] | length' \
            "$config_library/$applied_id.json")"
        if [ "$configured_marketplace_count" -gt 0 ]; then
            known_marketplaces_complete=0
            marketplace_session_root="$user_data_dir/local-agent-mode-sessions"
            if [ -d "$marketplace_session_root" ]; then
                # Read one path per line so spaces in persistent session paths
                # are preserved instead of being split by command substitution.
                if find "$marketplace_session_root" \
                    -type f -name known_marketplaces.json 2>/dev/null -print |
                    while IFS= read -r known_marketplaces; do
                        if jq -e --argjson expected "$configured_marketplace_count" \
                            'type == "object" and length >= $expected' \
                            "$known_marketplaces" >/dev/null; then
                            printf '%s\n' "$known_marketplaces"
                        fi
                    done | grep -q .; then
                    known_marketplaces_complete=1
                fi
            fi
            if [ "$known_marketplaces_complete" -eq 1 ]; then
                marketplace_tmp="$(mktemp "$config_library/.marketplaces.XXXXXX")"
                jq 'del(.allowedPluginMarketplaces)' \
                    "$config_library/$applied_id.json" > "$marketplace_tmp"
                install -o "$user_id" -g "$group_id" -m 0600 \
                    "$marketplace_tmp" "$config_library/$applied_id.json"
                rm -f "$marketplace_tmp"
                printf '[claude-config] marketplace provisioning completed; using persistent native registry\n'
            fi
        fi
        printf '[claude-config] preserving existing writable 3P configuration library\n'
    fi

    rm -f /etc/claude-desktop/managed-settings.json
    printf '[claude-config] remote Gateway settings enabled; managed configuration disabled\n'
    exit 0
fi

rm -f /etc/claude-desktop/managed-settings.json
install -o root -g "${GROUP_ID:-1000}" -m 0440 \
    "$tmp_file" \
    /etc/claude-desktop/managed-settings.json

printf '[claude-config] managed 3P Gateway configuration installed; model discovery disabled\n'

