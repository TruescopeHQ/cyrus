#!/usr/bin/env bash
#
# Install the Truescope fork of cyrus-ai over the top of the npm package,
# from a GitHub Release built by .github/workflows/truescope-release.yml.
#
#   scripts/truescope-install.sh              install the latest release
#   scripts/truescope-install.sh <version>    install a specific release (also how you roll back)
#                                              e.g. 0.2.74-truescope.b9e7c58
#   scripts/truescope-install.sh --list       list available releases
#
# This script does NOT stop or restart Cyrus. Restart it yourself afterwards.
#
# Env overrides:
#   CYRUS_FORK_REPO   GitHub owner/repo (default: TruescopeHQ/cyrus)

set -euo pipefail

REPO="${CYRUS_FORK_REPO:-TruescopeHQ/cyrus}"

case "$(uname -m)" in
x86_64 | amd64) ARCH=x64 ;;
aarch64 | arm64) ARCH=arm64 ;;
*) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;
esac
[ "$(uname -s)" = Linux ] || { echo "release tarballs are Linux-only" >&2; exit 1; }

case "${1:-}" in
--list)
	curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=20" |
		node -e 'for (const r of JSON.parse(require("fs").readFileSync(0))) if (r.tag_name.includes("truescope")) console.log(r.tag_name.slice(1), r.published_at)'
	exit 0
	;;
-h | --help)
	sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
	exit 0
	;;
"") URL="https://github.com/$REPO/releases/latest/download/cyrus-ai-linux-$ARCH.tgz" ;;
*) URL="https://github.com/$REPO/releases/download/v$1/cyrus-ai-linux-$ARCH.tgz" ;;
esac

# Download first: npm may refuse remote tarball URLs (allow-remote).
TGZ="$(mktemp -d)/cyrus-ai.tgz"
trap 'rm -rf "$(dirname "$TGZ")"' EXIT
curl -fL --progress-bar -o "$TGZ" "$URL"

echo "was: $(cyrus --version 2>/dev/null || echo 'not installed')"
npm install -g "$TGZ"
hash -r
echo "now: $(cyrus --version)"
echo "Restart cyrus to activate."
