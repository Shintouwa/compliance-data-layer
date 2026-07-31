/**
 * The redaction backstop. architecture.md Part IV §6.
 *
 * Redaction happens in `redaction.py` 🔒 inside the sidecar. This is the second
 * line of defence, at the corpus write boundary. **If it ever fires in
 * production, stop the pipeline and fix the sidecar — do not weaken the
 * pattern.** Part V §3 lists it as page-and-halt, Sev-1.
 *
 * ---
 *
 * ONE CORRECTION TO THE §6 SNIPPET, and it is not cosmetic.
 *
 * §6 builds a single probe string:
 *
 *     const probe = JSON.stringify(finding.value_shape) + (finding.message ?? '');
 *
 * When `value_shape` is null — which is the normal case for a
 * `missing_mandatory` finding, where there was no value to shape —
 * `JSON.stringify(null)` is the literal `"null"`, and it is concatenated
 * directly onto the message. The UAE TRN pattern is `\b\d{15}\b`, and there is
 * no word boundary between the `l` of `null` and the first digit:
 *
 *     "null" + "100000000000003"  ->  "null100000000000003"   // no match
 *     "100000000000003"           ->  match
 *
 * So the concatenation itself suppresses the detection, in exactly the case the
 * check exists for. The fields are therefore probed SEPARATELY below. The
 * patterns are unchanged — this strengthens the check rather than relaxing it.
 */

const RAW_VALUE_PATTERNS = [
  /\b\d{15}\b/,                        // UAE TRN
  /[A-Z]{2}\d{2}[A-Z0-9]{11,30}/,      // IBAN
  /\b[\w.+-]+@[\w-]+\.[\w.]+\b/,       // email
];

function scan(probe: string): boolean {
  return RAW_VALUE_PATTERNS.some((pattern) => pattern.test(probe));
}

/** Checks value_shape AND message — the message string is the leak path. */
export function assertRedacted(finding: { value_shape: unknown; message?: string }): void {
  const shapeProbe = finding.value_shape === null || finding.value_shape === undefined
    ? ''
    : JSON.stringify(finding.value_shape);

  if (scan(shapeProbe) || scan(finding.message ?? '')) {
    throw new Error(
      'REDACTION FAILURE: raw value detected in corpus payload. redaction.py has ' +
      'a defect. This is a Sev-1 — halt the pipeline. architecture.md Part I §2.9.',
    );
  }
}
