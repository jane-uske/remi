#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

rm -rf web/.next web/.next-dev

echo "Removed web/.next and web/.next-dev"
