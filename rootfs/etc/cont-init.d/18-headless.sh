#!/bin/sh

set -eu

case "${CLAUDE_HEADLESS:-1}" in
    0)
        printf '[claude-headless] disabled; retaining the VNC desktop services\n'
        exit 0
        ;;
    1)
        ;;
    *)
        printf '[claude-headless] ERROR: CLAUDE_HEADLESS must be 0 or 1\n' >&2
        exit 1
        ;;
esac

# Keep the service name `xvnc` because the base image dependency graph uses it
# as the X11 readiness provider. Its run target is replaced by Xvfb at build
# time. The services below only provide the unused desktop presentation layer.
for service in \
    audiorecorder \
    certsmonitor \
    nginx \
    openbox \
    pulseaudio \
    webauth \
    webservices \
    xcompmgr \
    xrdb
do
    : > "/etc/services.d/$service/disabled"
    rm -f "/etc/services.d/gui/$service.dep"
done

printf '[claude-headless] using Xvfb; VNC, window-manager, web-desktop and audio services disabled\n'
