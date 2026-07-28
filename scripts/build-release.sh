#!/bin/sh

set -eu

if [ "$#" -ne 3 ]; then
  echo "Usage: $0 <version> <bun-target> <output-directory>" >&2
  exit 2
fi

version="$1"
target="$2"
output_dir="$3"

case "$target" in
  bun-linux-x64|bun-linux-x64-baseline) platform="linux"; architecture="x64" ;;
  bun-linux-arm64) platform="linux"; architecture="arm64" ;;
  bun-darwin-x64) platform="darwin"; architecture="x64" ;;
  bun-darwin-arm64) platform="darwin"; architecture="arm64" ;;
  *)
    echo "Error: unsupported Bun target: ${target}" >&2
    exit 2
    ;;
esac

case "$version" in
  v*) tag="$version"; cli_version="${version#v}" ;;
  *) tag="v${version}"; cli_version="$version" ;;
esac

mkdir -p "$output_dir"
binary="${output_dir}/agent-browser-app"
archive="agent-browser-app-${tag}-${platform}-${architecture}.tar.gz"

bun build \
  --compile \
  --target="$target" \
  --define "AGENT_BROWSER_APP_BUILD_VERSION=\"${cli_version}\"" \
  --outfile="$binary" \
  src/cli.ts

if [ "$platform" = "darwin" ]; then
  codesign --remove-signature "$binary" >/dev/null 2>&1 || true
  codesign \
    --deep \
    --force \
    --sign - \
    --entitlements release/entitlements.plist \
    "$binary"
fi

tar -czf "${output_dir}/${archive}" -C "$output_dir" agent-browser-app

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd "$output_dir"
    sha256sum "$archive" > "${archive}.sha256"
  )
else
  (
    cd "$output_dir"
    shasum -a 256 "$archive" > "${archive}.sha256"
  )
fi

printf '%s\n' "${output_dir}/${archive}"
