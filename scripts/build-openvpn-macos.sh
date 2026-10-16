#!/bin/bash
# Builds a self-contained OpenVPN for macOS that DevCat ships (Contents/Resources/vpn/openvpn).
# OpenSSL, LZO and LZ4 are linked statically, so the binary only depends on macOS system
# libraries: the passwordless helper can copy it into a root-owned folder and run it safely.
# Sources are pinned by SHA-256 (OpenVPN's is also PGP-signed by security@openvpn.net).
#
# Usage: scripts/build-openvpn-macos.sh <arm64|aarch64|x86_64> [out-dir]   (default out: src-tauri/vpn-bin)
# Runs as the macOS beforeBuildCommand (tauri.macos.conf.json) with Tauri's target arch.
set -euo pipefail

ARCH="${1:?arch: arm64 or x86_64}"
[ "$ARCH" = aarch64 ] && ARCH=arm64
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${2:-$ROOT/src-tauri/vpn-bin}"
WORK="${OPENVPN_BUILD_DIR:-$ROOT/target-openvpn}/$ARCH"
MIN_MACOS=11.0

OPENSSL_V=3.5.9;  OPENSSL_SHA=603f5602e2eef00d77fbd429d34dcd5822bb301757a1bc9cdb24c670f1eb859a
LZO_V=2.10;       LZO_SHA=c0f892943208266f9b6543b3ae308fab6284c5c90e627931446fb49b4221a072
LZ4_V=1.10.0;     LZ4_SHA=537512904744b35e232912055ccf8ec66d768639ff3abe5788d90d792ec5f48b
OPENVPN_V=2.7.8;  OPENVPN_SHA=c070d1d2440b5a6fca6c2c68645c98cd492116ac36ef4f0946177115532c8e36

case "$ARCH" in
  arm64) HOST=aarch64-apple-darwin; OSSL_TARGET=darwin64-arm64-cc ;;
  x86_64) HOST=x86_64-apple-darwin; OSSL_TARGET=darwin64-x86_64-cc ;;
  *) echo "unknown arch $ARCH" >&2; exit 1 ;;
esac

if [ -x "$OUT/openvpn" ] && [ "$(cat "$OUT/openvpn.version" 2>/dev/null)" = "$OPENVPN_V-$ARCH" ]; then
  echo "openvpn $OPENVPN_V ($ARCH) already built in $OUT"; exit 0
fi

rm -rf "$WORK/prefix" "$WORK"/src/*/
mkdir -p "$WORK/src" "$WORK/prefix" "$OUT"
fetch() { # url sha256
  local f="$WORK/src/$(basename "$1")"
  [ -f "$f" ] || curl -sfL --retry 3 -o "$f" "$1"
  echo "$2  $f" | shasum -a 256 -c - >/dev/null || { echo "checksum mismatch: $1" >&2; rm -f "$f"; exit 1; }
  tar -xzf "$f" -C "$WORK/src"
}
fetch "https://github.com/openssl/openssl/releases/download/openssl-$OPENSSL_V/openssl-$OPENSSL_V.tar.gz" "$OPENSSL_SHA"
fetch "https://www.oberhumer.com/opensource/lzo/download/lzo-$LZO_V.tar.gz" "$LZO_SHA"
fetch "https://github.com/lz4/lz4/releases/download/v$LZ4_V/lz4-$LZ4_V.tar.gz" "$LZ4_SHA"
fetch "https://swupdate.openvpn.org/community/releases/openvpn-$OPENVPN_V.tar.gz" "$OPENVPN_SHA"

P="$WORK/prefix"
export CFLAGS="-arch $ARCH -mmacosx-version-min=$MIN_MACOS -O2"
export LDFLAGS="-arch $ARCH -mmacosx-version-min=$MIN_MACOS"
export MACOSX_DEPLOYMENT_TARGET=$MIN_MACOS
JOBS=$(sysctl -n hw.ncpu)

( cd "$WORK/src/openssl-$OPENSSL_V"
  ./Configure "$OSSL_TARGET" no-shared no-tests no-docs no-apps no-module no-legacy --prefix="$P" --libdir=lib -mmacosx-version-min=$MIN_MACOS >/dev/null
  make -j"$JOBS" build_libs >/dev/null && make install_dev >/dev/null )

( cd "$WORK/src/lzo-$LZO_V"
  ./configure --host="$HOST" --prefix="$P" --disable-shared --enable-static >/dev/null
  make -j"$JOBS" >/dev/null && make install >/dev/null )

( cd "$WORK/src/lz4-$LZ4_V/lib"
  make -j"$JOBS" liblz4.a CFLAGS="$CFLAGS" >/dev/null
  mkdir -p "$P/lib" "$P/include" && cp liblz4.a "$P/lib/" && cp lz4.h lz4hc.h lz4frame.h "$P/include/" )

# GIT_DIR: don't let OpenVPN's build stamp DevCat's git commit into its version string.
( cd "$WORK/src/openvpn-$OPENVPN_V"
  export GIT_DIR=/nonexistent
  ./configure --host="$HOST" \
    --disable-plugins --disable-pkcs11 --disable-debug --disable-unit-tests --disable-dependency-tracking \
    OPENSSL_CFLAGS="-I$P/include" OPENSSL_LIBS="$P/lib/libssl.a $P/lib/libcrypto.a" \
    LZO_CFLAGS="-I$P/include" LZO_LIBS="-L$P/lib -llzo2" \
    LZ4_CFLAGS="-I$P/include" LZ4_LIBS="-L$P/lib -llz4" >/dev/null
  make -j"$JOBS" >/dev/null
  cp src/openvpn/openvpn "$OUT/openvpn" )

strip -x "$OUT/openvpn"
# Only macOS system libraries may be linked (nothing a user could swap).
if otool -L "$OUT/openvpn" | tail -n +2 | grep -vE '^\s+(/usr/lib/|/System/Library/)'; then
  echo "openvpn links non-system libraries" >&2; exit 1
fi
lipo -archs "$OUT/openvpn" | grep -qx "$ARCH"
codesign --force --sign - "$OUT/openvpn"
echo "$OPENVPN_V-$ARCH" > "$OUT/openvpn.version"
"$OUT/openvpn" --version | head -1 || true
