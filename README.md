# Claude Desktop NAS

Runs Anthropic's official Linux Claude Desktop package in a browser-accessible
GUI container. Claude Desktop uses its supported third-party inference
configuration and stores Chat, Cowork, and Code state under the persistent
`/config` mount.

## Chat and Cowork Remote IPC Bridge

The production headless stack exposes one direct browser endpoint and one
HTTPS reverse-proxy entry point:

- `http://NAS_IP:15821` is the responsive Chat/Cowork WebUI and Remote IPC
  Bridge API.
- `https://claude-home.172906573.xyz:28443` is the installable PWA endpoint
  through the host's existing Nginx Proxy Manager and Authelia.

The Cowork endpoint is not VNC. Its request path is browser HTTP -> bridge ->
loopback-only main-process adapter -> the trusted official `app://localhost`
renderer -> Claude Desktop IPC -> the official Cowork session manager and VM.
It reads and controls the same persisted sessions as the native Desktop window
without copying or directly editing session files.

The adapter endpoint is bound to `127.0.0.1` inside the shared container
network namespace and is never published to the NAS. Claude Desktop explicitly
rejects unsigned CDP startup, so the adapter keeps the official ASAR at its
normal path and injects a two-file entry shim after each signed-package update.
Only a versioned Cowork method allowlist is exposed. Destructive methods remain
disabled by default.

Chat and Cowork share Claude Desktop's official `LocalAgentModeSessions`
manager but are separated by the persisted `sessionType`. Typed Chat endpoints
only accept `sessionType=chat`; typed Cowork endpoints exclude those sessions.
Both modes therefore use the same official local history while remaining
separate in remote clients.

The primary WebUI is the official `ion-dist` interface installed by the current
Claude Desktop package. It is not an assistant-ui or locally recreated message
view. The bridge reads the entry and hashed assets from the running Desktop
container on each request, so package updates automatically select the matching
official frontend. No official frontend bundle or icon is copied into this
project. The supplied CJK-complete Anthropic Serif font is served separately
for Chinese response typography.

Only the response for the official `index.html` is modified. It receives a
small Remote Preload Shim before the official module starts. The shim defines
`globalThis["claude.web"]` from a server-generated method allowlist and sends
those calls to the loopback-only Desktop renderer bridge. Native Desktop event
callbacks are relayed back over SSE, so permission and session events retain
their official payloads. Code/`LocalSessions` is exposed only when the separate
`CLAUDE_REMOTE_CODE_ACTIONS=1` opt-in is enabled.

The shim also relays the installed Desktop runtime's Chat/Cowork capabilities
and, when enabled, the official Code capability records. The wrapper reads
them from Desktop's
official `getSupportedFeaturesSync()` evaluator so Linux's asynchronous
virtualization probe cannot leave the remote UI stuck on the window's
transient startup snapshot. These official flags keep the 3P route selector
and Chat/Cowork sidebar on the bridged surfaces; native-only feature flags are not
advertised to the browser.

Cowork additionally requires ion-dist's own Desktop-runtime check. The shim
adds the running official package version as the `Claude/<version>` user-agent
token and exposes only `claudeAppBindings.registerBinding`/
`unregisterBinding`, which are the two identity/lifecycle primitives used by
that check. The version comes from Electron `app.getVersion()` after the
startup update check, so it stays aligned with automatic package upgrades.
When `CLAUDE_REMOTE_DEVELOPER_ACTIONS=1`, the bridge also exposes the official
allowlisted MCP, local Skill, marketplace, and Plugin management IPC used by
the shipped Directory and settings screens. Unrelated native bindings remain
absent.

When `CLAUDE_REMOTE_INFRASTRUCTURE_ACTIONS=1`, the official interface also gets
the exact mutation IPC used by Cowork Projects/Spaces, Artifact import and
sharing controls, Memory CRUD, and Scheduled Tasks create/edit/status flows.
The general destructive switch remains off: only Artifact deletion, account-
memory deletion, and Space deletion are admitted by this narrower flag;
`resetMemories`, bridge reset, and Artifact version restore remain unavailable.

When `CLAUDE_REMOTE_CODE_ACTIONS=1`, the official Code tab receives the local
session, transcript, Git, terminal, permission, MCP, and workspace file IPC it
uses. Code executes inside the official Desktop container and its normal
working root is the mounted `/workspace`; it does not execute on the browser or
the device opening the WebUI. Remote-control, SSH, cloud teleport, PR mutation,
and automatic repository commit/stash/discard methods are not published.

Remote attachments use a browser file picker rather than Electron's native
dialog, because a native dialog would open inside the hidden Linux container.
Selected files are uploaded in one batch (50 MiB maximum) to a unique directory
under `/workspace/RemoteUploads`, then their server paths are passed to the
unchanged official Cowork APIs. Open/download uses the browser and Reveal opens
a read-only NAS workspace directory view. A browser cannot open Explorer/Finder
on the phone or PC that is viewing the WebUI.

The official frontend's selected HTTP requests, including `/edge-api/bootstrap`,
`/api/bootstrap`,
model configuration, account bootstrap, and title generation, are forwarded to
the official Desktop `app://localhost` third-party protocol handler. Both the
public bridge and the Desktop wrapper enforce the same method/path allowlists.
Only `accept`, `accept-language`, and `content-type` request headers cross that
boundary. JSON responses containing credential field names are rejected. By
default the Gateway API key exists only in the Desktop container and is neither
present in the Web bridge environment nor injected into browser bootstrap data.

The WebUI also ships a local manifest, mobile safe-area rules, and a service
worker. Its 512px PWA icon is served from the installed official Desktop package
at runtime. API
requests are never cached; the injected entry uses network-first recovery and
official content-hashed assets use cache-first recovery. Responsive browser use
works over the direct HTTP port. The Remote Preload supplies an RFC 4122 UUID v4
compatibility function backed by `crypto.getRandomValues` because Chromium does
not expose `crypto.randomUUID` to an HTTP LAN origin. When `SubtleCrypto` is
also unavailable, only SHA-256/384/512 digest calls are forwarded to a dedicated
NAS endpoint; key generation, signing, encryption, and arbitrary algorithms are
not polyfilled. PWA installation and service workers still require a secure
HTTPS origin. Direct `http://LAN_IP:15821` browsing works but cannot trigger a
standards-compliant PWA install; use
`https://claude-home.172906573.xyz:28443` for installation.

The Nginx entry reuses the existing `*.172906573.xyz` certificate and proxies
to `claude-desktop:8080` over the shared `gateway_net`, with SSE buffering
disabled. It uses the same Authelia AuthRequest endpoint as the other protected
`*-home` services. The existing `*.172906573.xyz` Authelia access-control rule
requires two-factor authentication; no source-IP allowlist is applied. LAN and
Tailnet DNS should resolve the hostname to the NAS (`192.168.31.201` on LAN or
the NAS Tailscale address).

Open WebUI clients share a server-sent event stream at
`GET /api/events?mode=chat|cowork&sessionId=:id`. The bridge reads the official
Desktop session list once per second for all connected clients and de-duplicates
transcript reads per selected session, then publishes title, model, running
state, and transcript changes to every subscriber. Transcript events contain
only fields required by the renderer; internal Desktop metadata and thinking
signatures are not forwarded. Browsers reconnect with native `EventSource`
semantics and fall back to a five-second HTTP poll while the stream is down.
The response includes `X-Accel-Buffering: no` for the active Nginx reverse
proxy.

Remote official-interface endpoints are:

- `POST /api/remote/ipc` for allowlisted `claude.web` function calls
- `POST /api/remote/store` for field-sanitized Desktop state stores
- `POST /api/remote/settings` for the opt-in official Gateway editor bridge
- `GET|PUT /api/account_profile` for field-restricted profile/instruction settings
- selected original `/api/bootstrap` and organization protocol routes

Gateway credentials and provider settings remain container-managed when
`CLAUDE_REMOTE_GATEWAY_SETTINGS=0`. Setting it to `1` is an explicit temporary
opt-in: the environment configuration seeds the official writable
`configLibrary` once, the official `/setup-desktop-3p` editor is bridged, and
subsequent edits persist under `/config`. On startup the same opt-in writes the
official `developer_settings.json` `allowDevTools` field, which makes the
official `Developer` top-level menu and its `Configure Third-Party Inference…`
item available; setting the variable back to `0` disables that official mode
on the next restart. In enabled mode credentials cross the browser connection,
so use it only behind HTTPS/authentication or on a trusted network.

The account menu's official `Inference configuration` item additionally
depends on `Custom3pSetup.getLoginDesktop3pStatus()`. The bridge exposes that
single read-only status method and strips the response to provider, source,
bootstrap host, and interactive-auth flags; credentials are never included.

The official Linux bundle currently renders its user-menu `Inference
configuration` action with a no-op click helper. The Remote Preload Shim
intercepts only that exact official menu item and opens
`/setup-desktop-3p`; the normal Claude `Settings` modal and all other menu
items retain their original behavior. The browser route adds a single Back to
Claude button to the official setup header and reconnects to the main view
after an expected Desktop relaunch transport interruption.

The top-left Windows hamburger normally invokes Electron's native
`BrowserNavigation.requestMainMenuPopup()`, which cannot paint an operating-
system menu inside a Web browser. The bridge reads the current File/Edit/View/
Developer/Help menu tree from Electron's live `Menu.getApplicationMenu()` and
renders that hierarchy in the Web/PWA layer using Claude's current design
tokens. The account menu remains a separate official ion-dist control. Safe
browser equivalents such as Settings, reload, zoom, copy URL, edit roles, and
Configure Third-Party Inference are enabled. Reload MCP Configuration uses one
dedicated no-argument, rate-limited action instead of a general main-process
command endpoint. When `CLAUDE_REMOTE_DEVELOPER_ACTIONS=1`, the remaining
official Developer actions are exposed through exact action identifiers: native
DevTools, main-process debugger, performance and memory tracing, and heap
snapshot. MCP log, `claude_desktop_config.json`, and
`developer_settings.json` use an allowlisted no-cache Web viewer/editor;
official trace and heap files use an allowlisted streaming download endpoint.
The same high-privilege switch enables the shipped `CustomPlugins`,
`LocalPlugins`, `PluginBridgeMcp`, local Skill, and direct MCP management
methods plus their official progress/status listeners. Repository cloning,
plugin installation, enablement, OAuth, and MCP operations still execute in
Claude Desktop's main process and persistent data directories; the browser
does not reimplement them.
No arbitrary filesystem path or generic Electron action is accepted. These
surfaces can reveal credentials and diagnostics, so keep the flag disabled
unless the service is behind trusted HTTPS authentication.

The older typed Chat and Cowork endpoints remain as narrow smoke-test and
recovery surfaces; they are no longer the primary browser UI implementation.

Chat endpoints are:

- `GET /api/chat/models`
- `GET|POST /api/chat/sessions`
- `GET /api/chat/sessions/:id`
- `GET /api/chat/sessions/:id/transcript`
- `POST /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/stop`
- `PATCH /api/chat/sessions/:id/model`
- `PATCH /api/chat/sessions/:id/title`

Creating a Chat session accepts `{"model":"claude-opus-5","message":"..."}`.
The bridge asks Claude Desktop's official local title generator for the title,
then starts the session through official renderer IPC. Continuing a session,
switching models, stopping it, and reading its transcript use the same IPC
surface; the bridge never calls the inference Gateway directly.
There is intentionally no application authentication in this stage. Port
`15821` is a normal host port binding, not a Tailscale Serve/Funnel service.
LAN clients can still use `LAN_IP:15821`; clients already joined to the
Tailscale network can use `TAILSCALE_IP:15821`. Prefer the HTTPS hostname for
PWA use. Authelia protects the HTTPS entry, while the direct host port remains
an intentionally trusted-network-only recovery endpoint.

Validate the read path with:

```sh
./scripts/cowork-bridge-smoke.sh
./scripts/chat-bridge-smoke.sh
```

Then use the UI to create or continue a Chat conversation, switch between
`claude-opus-5` and `claude-opus-4-8`, and confirm the same persisted state is
visible after a Desktop restart. The Cowork tab opens existing local tasks and
uses the same readable transcript renderer on desktop and mobile.

## Boundaries

- Claude is installed from Anthropic's signed APT repository.
- Every container start checks the signed repository and upgrades the package
  before the GUI launches.
- Only the Cowork bridge (`15821`) is published; the Electron/Xvfb renderer and
  raw VNC remain internal to the container.
- Phase 1 intentionally has no application authentication. The ports bind
  directly to the NAS host and should only be reachable from trusted networks
  (LAN or the existing Tailscale mesh). Nginx Proxy Manager and Authelia now
  provide the authenticated HTTPS/PWA entry.
- The container is not privileged and receives only `/dev/kvm` and
  `/dev/vhost-vsock` for Cowork.
- Cowork uses upstream Rust `virtiofsd` 1.13.3, built from a
  checksum-pinned release source in a digest-pinned Rust builder image. This
  matches the current official helper CLI and needs no extra file or container
  capabilities when the helper selects its container-oriented sandbox mode.
- Chromium keeps its user-namespace sandbox. A project-local seccomp profile
  starts from Moby's pinned default profile and permits only the namespace
  combinations observed during Claude Desktop startup plus `AF_VSOCK` for the
  official Cowork VM helper; the container does not use
  `seccomp=unconfined`, `--privileged`, or `CAP_SYS_ADMIN`.
- The host-side Claude Code sandbox has both `bubblewrap` and `socat`, so it
  does not silently fall back to unsandboxed execution because a proxy helper
  is missing.
- The managed Gateway configuration is root-owned, group-readable by the
  application, and mode `0440`, matching Claude Desktop's managed-policy
  ownership checks without making the API key world-readable.
- Static Gateway mode starts Electron with `--password-store=basic` to avoid a
  GNOME Keyring unlock prompt on every headless container start. Do not rely on
  this deployment for encrypted persistence of interactive login secrets.

## Configure and run

Edit `.env` and set:

- `CLAUDE_GATEWAY_BASE_URL`
- `CLAUDE_GATEWAY_API_KEY`
- `CLAUDE_GATEWAY_AUTH_SCHEME`
- `CLAUDE_INFERENCE_MODELS_JSON`
- `CLAUDE_REMOTE_GATEWAY_SETTINGS` (`0` by default; `1` temporarily enables the
  official remote Gateway editor)
- `CLAUDE_REMOTE_DEVELOPER_ACTIONS` (`0` by default; `1` enables high-privilege
  Developer actions and the allowlisted config/log/trace surface)
- `CLAUDE_REMOTE_INFRASTRUCTURE_ACTIONS` (`0` by default; `1` enables the
  allowlisted Projects/Spaces, Artifact, file, Memory, and Scheduled Tasks
  mutation methods)
- `CLAUDE_REMOTE_CODE_ACTIONS` (`0` by default; `1` publishes the official
  Code/LocalSessions surface, including terminal and workspace mutations)
- `CLAUDE_EGRESS_ALLOWED_HOSTS_JSON` (optional JSON array; `["*"]` gives Cowork,
  Code, and the plugin CLI unrestricted destinations subject to the NAS firewall)
- `CLAUDE_COWORK_VM_MEMORY_GB` and `CLAUDE_COWORK_VM_CPU_COUNT` (production
  defaults: `2` GiB and `1`; enforced at the Electron IPC boundary)
- `CLAUDE_COWORK_VM_IDLE_MINUTES` and
  `CLAUDE_COWORK_VM_SCHEDULE_GUARD_MINUTES` (production defaults: `30` and `10`)
- `CLAUDE_DESKTOP_MEMORY_LIMIT` and `CLAUDE_COWORK_BRIDGE_MEMORY_LIMIT`
  (production defaults: `3g` and `256m`)

The base URL normally omits `/v1` when the Gateway serves
`POST /v1/messages`. The model list must contain exact IDs accepted by the
Gateway. This deployment currently declares `claude-opus-4-8` and
`claude-opus-5` explicitly, so Claude Desktop does not need model discovery.

Some Gateway providers accept requests only when they originate from the
official Claude client. For those providers, a `curl` 401 is not a credential
test. Validate inference through the official Desktop UI.

The startup script merges `CLAUDE_EGRESS_ALLOWED_HOSTS_JSON` into the currently
applied writable 3P configuration without replacing its Gateway credential or
model fields. With `["*"]`, the official Egress Requirements page reports
unrestricted tool egress and GitHub marketplaces can be cloned. Existing local
marketplace clones remain in the persistent `/config` profile across restarts.
After every provisioned marketplace is present, startup removes the one-shot
`allowedPluginMarketplaces` list from the writable profile. This avoids the
current Desktop build treating a duplicate `marketplace add` as a load failure;
the official native marketplace registry remains persistent and authoritative.

Then run:

```bash
./scripts/prepare-seccomp.sh
docker compose build
docker compose up -d
./scripts/smoke.sh
```

`prepare-seccomp.sh` verifies the SHA-256 of Moby's pinned release profile
source before adding the narrowly scoped Chromium namespace rules and the
single `socket(AF_VSOCK)` rule Cowork requires. Run it again when rebuilding
this deployment on another host.

The services are published as ordinary Docker host-port bindings. Use either
the NAS LAN address or its Tailscale interface address; no Tailscale
Serve/Funnel configuration is involved:

```text
Desktop fallback:  http://192.168.31.201:15820/
Cowork bridge:     http://192.168.31.201:15821/

Desktop fallback:  http://100.102.63.126:15820/
Cowork bridge:     http://100.102.63.126:15821/

Official PWA:      https://claude-home.172906573.xyz:28443/
```

For the HTTPS hostname to stay private and work over Tailscale, configure a
split-DNS record for `claude-home.172906573.xyz` to the appropriate private NAS
address. The HTTPS entry is authenticated by Authelia; the direct `15821` port
does not inherit that authentication layer.

Do not print `docker compose config` after adding the API key because rendered
Compose output contains environment values.

## Persistent data

- `/vol2/1000/Docker/ClaudeDesktop/config`
- `/vol2/1000/Docker/ClaudeDesktop/workspace`

Stop Claude Desktop before taking a consistency-sensitive backup of its local
session state.

Cowork may use roughly 25 GB for its local VM image and working data. Monitor
storage headroom before relying on long-running Cowork sessions.

修改 IPC allowlist 时，请同步检查外层 Bridge 与 loopback adapter，说明为什么该方法需要远程暴露，并保持 destructive 能力默认关闭。

## License

本仓库当前未附带开源许可证。在许可证文件加入之前，默认版权规则适用；公开可见不等于自动授予复制、修改或再发布权。

## 致谢

- [Anthropic Claude Desktop](https://claude.ai/download) — 官方客户端与前端
- [jlesage/docker-baseimage-gui](https://github.com/jlesage/docker-baseimage-gui) — 浏览器桌面容器基础镜像
- [virtio-fs/virtiofsd](https://gitlab.com/virtio-fs/virtiofsd) — Cowork VM 文件共享
- [moby/profiles](https://github.com/moby/profiles) — seccomp 基础策略
  
## 社区

本项目在 [LINUX DO](https://linux.do/) 社区进行交流与发布，感谢社区提供的技术讨论环境。

Claude、Claude Desktop 及相关标识是 Anthropic 的商标。本项目仅提供互操作与自托管部署代码。
