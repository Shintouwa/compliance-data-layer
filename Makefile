# architecture.md Part I §1.5 — the only entrypoint.
#
# Command shapes are as specified in §1.5. The one addition is $(PY): CI installs
# the sidecar with `pip install -e apps/validator[dev]`, which puts python/mypy/
# pytest on PATH, but a local checkout runs them out of apps/validator/.venv.
# $(PY) resolves to the venv interpreter when one exists and to bare `python`
# otherwise, so the same Makefile is correct in both places.

SHELL := /usr/bin/bash
.SHELLFLAGS := -eu -o pipefail -c

VENV_PY := apps/validator/.venv/Scripts/python.exe
ifeq (,$(wildcard $(VENV_PY)))
VENV_PY := apps/validator/.venv/bin/python
endif
ifeq (,$(wildcard $(VENV_PY)))
PY := python
else
PY := $(abspath $(VENV_PY))
endif
export PY

.PHONY: dev test check corpus contract migrate deploy contract-update setup

setup:          ## One-time local toolchain: venv + node deps
	python -m uv venv --python 3.12 apps/validator/.venv
	python -m uv pip install --python apps/validator/.venv -e "apps/validator[dev]"
	pnpm install

dev:
	docker compose up -d postgres
	pnpm --filter web dev & \
	cd apps/validator && uvicorn validator.main:app --reload --port 8080

check:          ## Everything CI runs, locally, in CI order
	pnpm tsc --noEmit
	pnpm eslint . --max-warnings 0
	cd apps/validator && "$(PY)" -m mypy --strict src/
	$(MAKE) test
	$(MAKE) corpus
	$(MAKE) contract

test:
	pnpm vitest run
	cd apps/validator && "$(PY)" -m pytest -q

corpus:         ## Golden File Corpus — the important one (§3)
	cd apps/validator && "$(PY)" -m validator.cli.corpus_runner ../../tests/corpus

contract:
	./scripts/contract-check.sh

contract-update:
	cd apps/validator && "$(PY)" ../../scripts/dump-openapi.py
	pnpm openapi-typescript packages/contracts/validator.openapi.json \
	  -o packages/contracts/validator.d.ts

migrate:        ## Generate, apply, then RE-APPLY policies (§2.10)
	pnpm drizzle-kit generate
	pnpm drizzle-kit migrate
	psql "$$DATABASE_URL" -f packages/db/policies/001_roles_and_grants.sql
	psql "$$DATABASE_URL" -f packages/db/policies/002_corpus_append_only.sql
	psql "$$DATABASE_URL" -f packages/db/policies/003_client_data_rls.sql

deploy:
	git push origin main
