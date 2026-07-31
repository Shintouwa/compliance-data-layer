/**
 * Structured logging. architecture.md Part V §2 — the observability contract.
 *
 * Every job log line carries, without exception:
 *
 *   { "job": "validate.run", "run_id": "…", "tenant_id": "…", "doc_hash": "…",
 *     "spec_version": "…", "ruleset_hash": "…", "trace_id": "…", "attempt": 2 }
 *
 * One JSON object per line, to stdout: Vercel and Datadog both ingest that
 * without an agent, and `child()` is what makes the contract above cheap enough
 * that nobody is tempted to drop a field.
 *
 * **A raw client value must never reach a log line** (CLAUDE.md §4.6). Bindings
 * are `value_shape`, hashes and identifiers only. There is no redaction filter
 * here on purpose: a filter invites people to log the value and trust the
 * filter, and the filter is the thing that will have the bug.
 */

export type LogValue = string | number | boolean | null | undefined | LogValue[]
  | { [key: string]: LogValue };
export type LogBindings = Record<string, LogValue>;
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL;
  if (configured !== undefined && configured in LEVEL_ORDER) {
    return LEVEL_ORDER[configured as LogLevel];
  }
  return process.env.NODE_ENV === 'production' ? LEVEL_ORDER.info : LEVEL_ORDER.debug;
}

export interface Logger {
  debug(message: string, extra?: LogBindings): void;
  info(message: string, extra?: LogBindings): void;
  warn(message: string, extra?: LogBindings): void;
  error(message: string, extra?: LogBindings): void;
  child(bindings: LogBindings): Logger;
}

function emit(level: LogLevel, bindings: LogBindings, message: string, extra?: LogBindings): void {
  if (LEVEL_ORDER[level] < threshold()) return;
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    msg: message,
    ...bindings,
    ...extra,
  });
  // stdout/stderr IS the log transport here — Vercel and Datadog both ingest it
  // without an agent. Part V §2.
  if (level === 'error') console.error(line);
  else console.log(line);
}

export function createLogger(bindings: LogBindings = {}): Logger {
  return {
    debug: (m, e) => { emit('debug', bindings, m, e); },
    info: (m, e) => { emit('info', bindings, m, e); },
    warn: (m, e) => { emit('warn', bindings, m, e); },
    error: (m, e) => { emit('error', bindings, m, e); },
    child: (extra) => createLogger({ ...bindings, ...extra }),
  };
}

export const logger = createLogger();

/**
 * Errors are serialised for `app.job_execution.error` and for log lines. The
 * message is included because our own errors are written to be diagnostic and
 * value-free; `cause` chains are followed because `UnrecoverableError` wrapping
 * a fetch failure is the common shape.
 */
export function serialiseError(err: unknown): LogBindings {
  if (err instanceof Error) {
    const out: LogBindings = { name: err.name, message: err.message };
    if (err.stack !== undefined) out.stack = err.stack;
    if (err.cause !== undefined) out.cause = serialiseError(err.cause);
    return out;
  }
  return { name: 'NonError', message: String(err) };
}
