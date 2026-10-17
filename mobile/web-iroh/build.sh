#!/bin/sh
# Builds the browser endpoint (WebAssembly) and its JS bindings
# into mobile/web-iroh/pkg (imported as "devcat-web-iroh"), for the hosted browser version (`pnpm mobile:hosted`).
# Needs: rustup target add wasm32-unknown-unknown; wasm-bindgen-cli matching the wasm-bindgen
# version in Cargo.lock (WASM_BINDGEN=path, default: on PATH). On macOS also an llvm-ar for the
# C parts of ring (rustup component add llvm-tools; found automatically).
set -e
cd "$(dirname "$0")"
if [ -z "$AR_wasm32_unknown_unknown" ]; then
  AR=$(find "$(rustc --print sysroot)" -name llvm-ar -type f 2>/dev/null | head -1)
  [ -n "$AR" ] && export AR_wasm32_unknown_unknown="$AR"
fi
cargo build --target wasm32-unknown-unknown --release $CARGO_FLAGS
"${WASM_BINDGEN:-wasm-bindgen}" --target web --no-typescript --out-dir pkg \
  target/wasm32-unknown-unknown/release/devcat_web_iroh.wasm
