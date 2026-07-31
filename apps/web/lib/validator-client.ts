/**
 * The validator sidecar client. architecture.md Part III §5, Part IV §4 job 4.
 *
 * **Every request and response shape comes from `@repo/contracts`**, which is
 * generated from `apps/validator/src/validator/models.py` and committed
 * (§1.6). Nothing here hand-writes a validator request or response shape — that
 * is the whole point of the contract check, and it is what converts the one
 * genuine risk of decoupling the sidecar into a compile error.
 */

import type { ValidateRequest, ValidateResponse, ValidatorErrorBody } from '@repo/contracts';
import { validatorEnv } from './env';

/** Malformed XML. **Do not retry** — a malformed document is a finding, not an outage. */
export class ValidatorParseError extends Error {
  public override readonly name = 'ValidatorParseError';
  public constructor(public readonly line: number, public readonly column: number) {
    super(`Sidecar could not parse the document (line ${String(line)}, column ${String(column)}).`);
  }
}

/** Unknown profile or version. Deterministic — retrying cannot fix it. */
export class ValidatorUnknownSpec extends Error {
  public override readonly name = 'ValidatorUnknownSpec';
  public constructor(public readonly available: readonly string[]) {
    super(`Sidecar does not serve that profile/version. Available: ${available.join(', ')}.`);
  }
}

/** Saxon failure. Retry per policy; the correlation id joins to the Sentry event. */
export class ValidatorEngineFailure extends Error {
  public override readonly name = 'ValidatorEngineFailure';
  public constructor(public readonly correlationId: string) {
    super(`Sidecar engine failure, correlation_id=${correlationId}.`);
  }
}

/** >30s. **Caller retries once with `stop_on_first_error: true`.** */
export class ValidatorTimeout extends Error {
  public override readonly name = 'ValidatorTimeout';
}

function isErrorBody(body: unknown): body is ValidatorErrorBody {
  return typeof body === 'object' && body !== null && 'error' in body;
}

async function post(request: ValidateRequest): Promise<ValidateResponse> {
  const env = validatorEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, env.VALIDATOR_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${env.VALIDATOR_URL.replace(/\/$/, '')}/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ValidatorTimeout(`No response within ${String(env.VALIDATOR_TIMEOUT_MS)}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 504) throw new ValidatorTimeout('Sidecar returned 504.');

  const body: unknown = await response.json();

  if (response.ok) return body as ValidateResponse;

  if (isErrorBody(body)) {
    switch (body.error) {
      case 'parse_error':
        throw new ValidatorParseError(body.line, body.column);
      case 'unknown_spec':
        throw new ValidatorUnknownSpec(body.available);
      case 'engine_failure':
        throw new ValidatorEngineFailure(body.correlation_id);
      case 'invalid_request':
        // Our own request was malformed against the generated contract. That is
        // a bug here, not a client-data problem, and retrying will not fix it.
        throw new Error(
          `Sidecar rejected the request shape: ${body.fields.join(', ')}. ` +
          'Run `make contract-update` — @repo/contracts is out of date.',
        );
      default:
        break;
    }
  }
  throw new Error(`Sidecar returned ${String(response.status)} with an unrecognised body.`);
}

/**
 * Validate one document.
 *
 * On 504 the caller **retries once with `stop_on_first_error: true`** before
 * consuming a further attempt (Part IV §4 job 4). That retry lives here so no
 * handler can forget it.
 */
export async function validateDocument(request: ValidateRequest): Promise<ValidateResponse> {
  try {
    return await post(request);
  } catch (err) {
    if (!(err instanceof ValidatorTimeout)) throw err;
    return post({
      ...request,
      options: {
        include_warnings: request.options?.include_warnings ?? true,
        stop_on_first_error: true,
      },
    });
  }
}
