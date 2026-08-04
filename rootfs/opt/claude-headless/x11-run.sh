#!/bin/sh

set -eu

if [ "${CLAUDE_HEADLESS:-1}" = "1" ]; then
    exec /usr/bin/Xvfb "${DISPLAY:-:0}" \
        -screen 0 "${DISPLAY_WIDTH:-1280}x${DISPLAY_HEIGHT:-720}x24" \
        -nolisten tcp \
        -noreset
fi

exec /opt/base/bin/Xvnc "$@"
