FROM rust:1.85.1-bookworm@sha256:e51d0265072d2d9d5d320f6a44dde6b9ef13653b035098febd68cce8fa7c0bc4 AS virtiofsd-builder

ARG VIRTIOFSD_VERSION=1.13.3
ARG VIRTIOFSD_SOURCE_SHA256=9d5e67e7b19f52a8d3c411acf9beed6206e9352226cbf1e2bdaa4ed609a927ce

RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libcap-ng-dev \
        libseccomp-dev \
        pkg-config && \
    curl -fsSLo /tmp/virtiofsd.tar.gz \
        "https://gitlab.com/virtio-fs/virtiofsd/-/archive/v${VIRTIOFSD_VERSION}/virtiofsd-v${VIRTIOFSD_VERSION}.tar.gz" && \
    printf '%s  %s\n' \
        "$VIRTIOFSD_SOURCE_SHA256" \
        /tmp/virtiofsd.tar.gz \
        | sha256sum -c - && \
    tar -xzf /tmp/virtiofsd.tar.gz -C /tmp && \
    cd "/tmp/virtiofsd-v${VIRTIOFSD_VERSION}" && \
    cargo build --release --locked

FROM node:22-alpine AS wrapper-builder

WORKDIR /src

COPY bridge-wrapper ./bridge-wrapper

RUN npm install --prefix /opt/asar --omit=dev @electron/asar@3.2.17 && \
    mkdir -p /out/injection && \
    cp -a bridge-wrapper /out/injection/bridge-wrapper && \
    cp -a /opt/asar /out/asar

FROM node:22-bookworm-slim AS notion-mcp-builder

ARG NOTION_MCP_SERVER_VERSION=2.5.1

RUN npm install \
        --prefix /opt/notion-mcp \
        --omit=dev \
        --ignore-scripts \
        --no-audit \
        --no-fund \
        "@notionhq/notion-mcp-server@${NOTION_MCP_SERVER_VERSION}"

FROM jlesage/baseimage-gui:debian-12-v4.11.3

ARG CLAUDE_DESKTOP_VERSION=1.28929.0

RUN add-pkg \
        ca-certificates \
        curl \
        dbus-x11 \
        gnome-keyring \
        gnupg \
        jq \
        nodejs \
        ovmf \
        procps \
        qemu-system-x86 \
        xvfb \
        xdg-utils && \
    curl -fsSLo /usr/share/keyrings/claude-desktop-archive-keyring.asc \
        https://downloads.claude.ai/claude-desktop/key.asc && \
    test "$(gpg --show-keys --with-colons \
        /usr/share/keyrings/claude-desktop-archive-keyring.asc \
        | awk -F: '$1 == "fpr" { print $10; exit }')" = \
        "31DDDE24DDFAB679F42D7BD2BAA929FF1A7ECACE" && \
    echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/claude-desktop-archive-keyring.asc] https://downloads.claude.ai/claude-desktop/apt/stable stable main" \
        > /etc/apt/sources.list.d/claude-desktop.list && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        "claude-desktop=${CLAUDE_DESKTOP_VERSION}" && \
    test "$(dpkg-query -W -f='${Version}' claude-desktop)" = "${CLAUDE_DESKTOP_VERSION}" && \
    printf '%s\n' "${CLAUDE_DESKTOP_VERSION}" \
        > /opt/claude-desktop-image-version && \
    rm -rf /var/lib/apt/lists/*

# Claude Code's Linux sandbox uses bubblewrap from the official package and
# socat for its local network proxy. Keep this separate so package refreshes do
# not invalidate the large official Desktop dependency layer.
RUN add-pkg socat

COPY --from=virtiofsd-builder \
    /tmp/virtiofsd-v1.13.3/target/release/virtiofsd \
    /usr/bin/virtiofsd

COPY --from=wrapper-builder /out/ /opt/claude-cowork-bridge/
COPY --from=notion-mcp-builder /opt/notion-mcp/ /opt/notion-mcp/

COPY rootfs/ /
COPY config/release.json /opt/claude-cowork-bridge/release.json
COPY bridge/public/fonts/AnthropicSerif-Text-Regular-CJK.otf \
    /usr/local/share/fonts/claudesk/AnthropicSerif-Text-Regular-CJK.otf

# On this NAS, root inside a container has CAP_DAC_OVERRIDE and dash's `test -x`
# reports regular 0644 files as executable.  The upstream init script uses
# `test -x` to distinguish literal environment files from scripts, so make that
# decision from the actual mode bits instead.
RUN node -e 'const fs=require("fs");const p="/opt/claude-cowork-bridge/release.json";const r=JSON.parse(fs.readFileSync(p));r.desktopVersion=process.argv[1];fs.writeFileSync(p,JSON.stringify(r,null,2)+"\n")' "${CLAUDE_DESKTOP_VERSION}" && \
    fc-cache -f && \
    sed -i \
        's/if \[ -x "${fpath}" \]; then/if stat -c "%A" "${fpath}" | grep -q "[xst]"; then/' \
        /init && \
    sed -i \
        's/if \[ ! -x "${f}" \]; then/if ! stat -c "%A" "${f}" | grep -q "[xst]"; then/' \
        /init && \
    sed -i \
        's@if \[ -x "$1" \]; then@if find "$1" -prune -perm /111 2>/dev/null | grep -q .; then@' \
        /etc/cont-init.d/10-init-users.sh && \
    sed -i \
        's@if \[ -x /startapp.sh \]; then@if stat -c "%A" /startapp.sh | grep -q "[xst]"; then@' \
        /etc/services.d/app/run && \
    sed -i \
        's/if \[ ! -x "${fpath}" \]; then/if ! stat -c "%A" "${fpath}" | grep -q "[xst]"; then/' \
        /etc/services.d/exit && \
    rm -f /etc/services.d/xvnc/run && \
    ln -s /opt/claude-headless/x11-run.sh /etc/services.d/xvnc/run && \
    test "$(/usr/bin/virtiofsd --version | awk '{print $2}')" = "1.13.3" && \
    chmod 0755 \
        /startapp.sh \
        /opt/claude-headless/x11-run.sh \
        /etc/cont-init.d/18-headless.sh \
        /etc/cont-init.d/25-cowork-bridge-wrapper.sh \
        /etc/cont-init.d/30-claude-config.sh && \
    set-cont-env APP_NAME "Claude Desktop Official Linux" && \
    set-cont-env APP_VERSION "official-apt"

ENV CLAUDE_DESKTOP_VERSION=${CLAUDE_DESKTOP_VERSION}

LABEL io.claudesk.desktop-version="${CLAUDE_DESKTOP_VERSION}"

EXPOSE 5800
