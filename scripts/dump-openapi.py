"""Emit the validator's OpenAPI document. architecture.md Part I §1.6.

Offline and deterministic — never requires a running server. `sort_keys=True` is
what makes the diff in contract-check.sh meaningful rather than noise.

Run from apps/validator:
    python ../../scripts/dump-openapi.py            # write the artefact
    python ../../scripts/dump-openapi.py --stdout   # for the CI diff

Both paths write BYTES with explicit LF. §1.6 gives this script as
`write_text(spec)` / `sys.stdout.write(spec)`, which on Windows translates every
\\n to \\r\\n: the artefact is committed LF (see /.gitattributes), so the check
would diff CRLF against LF and fail on every Windows machine while passing in
CI. The contract check is a byte-for-byte comparison, so the encoding of this
output is part of the contract.
"""

import json
import pathlib
import sys

from validator.main import app

spec = (json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n").encode("utf-8")

if "--stdout" in sys.argv:
    sys.stdout.buffer.write(spec)
else:
    pathlib.Path("../../packages/contracts/validator.openapi.json").write_bytes(spec)
