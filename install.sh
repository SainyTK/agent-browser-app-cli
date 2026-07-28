#!/bin/sh

set -eu

repository="${AGENT_BROWSER_APP_REPOSITORY:-SainyTK/agent-browser-app-cli}"
api_url="${AGENT_BROWSER_APP_API_URL:-https://api.github.com}"
download_url="${AGENT_BROWSER_APP_DOWNLOAD_URL:-https://github.com}"
install_dir="${AGENT_BROWSER_APP_INSTALL_DIR:-${HOME}/.local/bin}"
channel="lts"

usage() {
  cat <<'EOF'
Install agent-browser-app from GitHub Releases.

Usage:
  install.sh [--channel lts|preview] [--install-dir <directory>]

Environment:
  AGENT_BROWSER_APP_INSTALL_DIR  Installation directory. Default: $HOME/.local/bin
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --channel)
      if [ "$#" -lt 2 ]; then
        echo "Error: --channel requires lts or preview." >&2
        exit 2
      fi
      channel="$2"
      shift 2
      ;;
    --install-dir)
      if [ "$#" -lt 2 ]; then
        echo "Error: --install-dir requires a directory." >&2
        exit 2
      fi
      install_dir="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Error: unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

case "$channel" in
  lts|preview) ;;
  *)
    echo "Error: unsupported channel \"$channel\". Use lts or preview." >&2
    exit 2
    ;;
esac

case "$(uname -s)" in
  Darwin) platform="darwin" ;;
  Linux) platform="linux" ;;
  *)
    echo "Error: agent-browser-app supports macOS and Linux." >&2
    exit 1
    ;;
esac

case "$(uname -m)" in
  x86_64|amd64) architecture="x64" ;;
  arm64|aarch64) architecture="arm64" ;;
  *)
    echo "Error: unsupported CPU architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required." >&2
  exit 1
fi

if [ "$channel" = "lts" ]; then
  release_json="$(curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    "${api_url}/repos/${repository}/releases/latest")"
  tag="$(printf '%s\n' "$release_json" |
    sed -n 's/^[[:space:]]*"tag_name":[[:space:]]*"\([^"]*\)".*/\1/p' |
    head -n 1)"
else
  releases_json="$(curl -fsSL \
    -H "Accept: application/vnd.github+json" \
    "${api_url}/repos/${repository}/releases?per_page=100")"
  tag="$(printf '%s\n' "$releases_json" |
    awk '
      /"tag_name":[[:space:]]*"/ {
        line = $0
        sub(/^.*"tag_name":[[:space:]]*"/, "", line)
        sub(/".*$/, "", line)
        candidate = line
      }
      /"prerelease":[[:space:]]*true/ && candidate != "" {
        print candidate
        exit
      }
    ')"
fi

if [ -z "$tag" ]; then
  echo "Error: no published ${channel} release was found." >&2
  exit 1
fi

archive="agent-browser-app-${tag}-${platform}-${architecture}.tar.gz"
asset_url="${download_url}/${repository}/releases/download/${tag}/${archive}"
temporary_dir="$(mktemp -d "${TMPDIR:-/tmp}/agent-browser-app-install.XXXXXX")"

cleanup() {
  if command -v trash >/dev/null 2>&1; then
    trash "$temporary_dir" >/dev/null 2>&1 || true
  else
    rm -rf "$temporary_dir"
  fi
}
trap cleanup EXIT HUP INT TERM

curl -fsSL "$asset_url" -o "${temporary_dir}/${archive}"
curl -fsSL "${asset_url}.sha256" -o "${temporary_dir}/${archive}.sha256"

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$temporary_dir"
    sha256sum -c "${archive}.sha256"
  )
elif command -v shasum >/dev/null 2>&1; then
  (
    cd "$temporary_dir"
    shasum -a 256 -c "${archive}.sha256"
  )
else
  echo "Error: sha256sum or shasum is required to verify the download." >&2
  exit 1
fi

tar -xzf "${temporary_dir}/${archive}" -C "$temporary_dir"
if [ ! -f "${temporary_dir}/agent-browser-app" ]; then
  echo "Error: release archive does not contain agent-browser-app." >&2
  exit 1
fi

mkdir -p "$install_dir"
install -m 755 "${temporary_dir}/agent-browser-app" \
  "${install_dir}/agent-browser-app"
ln -sf "agent-browser-app" "${install_dir}/aba"

echo "Installed agent-browser-app ${tag#v} (${channel}) to ${install_dir}/agent-browser-app"
echo "Installed alias: ${install_dir}/aba"

case ":${PATH}:" in
  *":${install_dir}:"*) ;;
  *)
    echo "Add ${install_dir} to PATH to run agent-browser-app or aba."
    ;;
esac
