#!/bin/sh

set -eu

project_dir="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
profile_dir="$project_dir/security"
profile_path="$profile_dir/claude-desktop.json"
source_url="https://raw.githubusercontent.com/moby/profiles/refs/tags/seccomp/v0.2.1/seccomp/default.json"
source_sha256="536529b665dd0972c37bfb569f5d4ac8a53592e7b00752bc39ff063ca9864c74"

install -d -m 0755 "$profile_dir"
source_file="$(mktemp /tmp/claude-seccomp-source.XXXXXX)"
generated_file="$(mktemp /tmp/claude-seccomp-generated.XXXXXX)"
trap 'rm -f "$source_file" "$generated_file"' EXIT HUP INT TERM

curl -fsSL --retry 3 --retry-delay 2 \
    "$source_url" \
    -o "$source_file"

printf '%s  %s\n' "$source_sha256" "$source_file" | sha256sum -c - >/dev/null

# Keep Moby's current allowlist and add only the namespace operations Chromium's
# user-namespace sandbox needs on this host:
#   - unshare(CLONE_NEWUSER)
#   - clone(CLONE_NEWUSER)
#   - clone(CLONE_NEWPID)
#   - clone(CLONE_NEWUSER|CLONE_NEWPID|CLONE_NEWNET)
# Cowork's official Linux helper also needs to create an AF_VSOCK socket to
# communicate with the guest VM.  Moby's default profile intentionally leaves
# address family 40 out of its generic socket rules, so allow that family only.
jq '
    .syscalls += [
        {
            names: ["socket"],
            action: "SCMP_ACT_ALLOW",
            args: [{
                index: 0,
                value: 40,
                op: "SCMP_CMP_EQ"
            }]
        },
        {
            names: ["unshare"],
            action: "SCMP_ACT_ALLOW"
        },
        {
            names: ["clone"],
            action: "SCMP_ACT_ALLOW",
            args: [{
                index: 0,
                value: 2114060288,
                valueTwo: 268435456,
                op: "SCMP_CMP_MASKED_EQ"
            }],
            excludes: {
                arches: ["s390", "s390x"]
            }
        },
        {
            names: ["clone"],
            action: "SCMP_ACT_ALLOW",
            args: [{
                index: 0,
                value: 2114060288,
                valueTwo: 536870912,
                op: "SCMP_CMP_MASKED_EQ"
            }],
            excludes: {
                arches: ["s390", "s390x"]
            }
        },
        {
            names: ["clone"],
            action: "SCMP_ACT_ALLOW",
            args: [{
                index: 0,
                value: 2114060288,
                valueTwo: 1879048192,
                op: "SCMP_CMP_MASKED_EQ"
            }],
            excludes: {
                arches: ["s390", "s390x"]
            }
        }
    ]
' "$source_file" > "$generated_file"

install -m 0644 "$generated_file" "$profile_path"
printf 'seccomp_profile=%s\n' "$profile_path"
