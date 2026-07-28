#!/usr/bin/env bash
# architecture.md Part I §1.6 — the OpenAPI contract check.
#
# Converts the single genuine risk of decoupling the sidecar from the web app
# into a compile error. Both artefacts are committed; the web app imports types
# from @repo/contracts and never hand-writes a validator request or response
# shape.
set -euo pipefail

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# $PY is exported by the Makefile so this works against the local venv and
# against CI's `pip install -e apps/validator[dev]` alike.
PYBIN="${PY:-python}"

diff -u packages/contracts/validator.openapi.json \
        <(cd apps/validator && "$PYBIN" ../../scripts/dump-openapi.py --stdout) \
  || { echo "::error::OpenAPI drifted. Run 'make contract-update' and commit."; exit 1; }

pnpm openapi-typescript packages/contracts/validator.openapi.json -o "$TMP/validator.d.ts" >/dev/null
diff -u packages/contracts/validator.d.ts "$TMP/validator.d.ts" \
  || { echo "::error::TS client drifted. Run 'make contract-update'."; exit 1; }

echo "Contract OK."
