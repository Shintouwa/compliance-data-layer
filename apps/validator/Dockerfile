# 🔒 HUMAN-OWNED — architecture.md Part I §1.8, CLAUDE.md §4.3
#
# saxonche ships GraalVM-compiled native binaries. This is the single most
# common agent-produced build failure in this stack. Any change to this file is
# a conformance-critical merge: full corpus green plus a manual review note in
# the PR.
#
# §1.8(2) requires an EXACT BASE IMAGE DIGEST, not a tag.
#   Resolved from Docker Hub registry API, 2026-07-28.
#   python:3.12-slim-bookworm -> multi-arch manifest digest below (pushed 2026-07-14).
#   Re-resolve with:
#     curl -s https://hub.docker.com/v2/repositories/library/python/tags/3.12-slim-bookworm \
#       | jq -r .digest
#
# WHY slim-bookworm and not alpine: SaxonC-HE links against glibc. musl (alpine)
# is not a supported target and fails at import time, not at build time — the
# worst possible failure mode for this stack.

FROM python@sha256:72d3d75f2639ab82b34b29390ad3d6e0827c775befee94edda8e9976818f488d AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# SaxonC-HE native library runtime dependencies.
#   libstdc++6 — the native image is C++-linked
#   zlib1g     — used by the Saxon native image for resource decompression
#   ca-certificates — TLS trust store; not used at validation time, required for pip
# Deliberately NOT installing a JVM: SaxonC-HE is ahead-of-time compiled and
# needs no Java runtime. Adding one masks a broken install behind a working one.
RUN apt-get update \
 && apt-get install --no-install-recommends -y \
      libstdc++6 \
      zlib1g \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependency layer first — pyproject.toml changes far less often than src/.
COPY pyproject.toml README.md ./
COPY src/ ./src/

RUN pip install --no-cache-dir .

# Fail the BUILD, not the first request, if the native library did not land.
# Without this the image builds green and dies on the first /validate call.
RUN python -c "\
from saxonche import PySaxonProcessor;\
p = PySaxonProcessor(license=False);\
v = p.version;\
print('SaxonC smoke test OK:', v);\
assert 'SaxonC' in v, v"

# Heroku requires a non-root runtime user.
RUN useradd --create-home --uid 1001 validator \
 && chown -R validator:validator /app
USER validator

EXPOSE 8080

# Heroku injects $PORT. Shell form so it expands; 8080 for local `docker run`.
CMD uvicorn validator.main:app --host 0.0.0.0 --port ${PORT:-8080}
