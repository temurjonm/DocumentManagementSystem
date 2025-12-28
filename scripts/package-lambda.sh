#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/lambda-build"
ZIP_PATH="$ROOT_DIR/lambda-package.zip"

if [ ! -d "$ROOT_DIR/dist" ]; then
  echo "dist/ not found. Run 'npm run build' first." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Please install Node.js before packaging." >&2
  exit 1
fi

if ! command -v zip >/dev/null 2>&1; then
  echo "zip not found. Please install zip before packaging." >&2
  exit 1
fi

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

cp -R "$ROOT_DIR/dist" "$BUILD_DIR/"
cp "$ROOT_DIR/package.json" "$ROOT_DIR/package-lock.json" "$BUILD_DIR/"

(
  cd "$BUILD_DIR"
  npm ci --omit=dev
  zip -qr "$ZIP_PATH" .
)

echo "✅ Lambda package created at $ZIP_PATH"
