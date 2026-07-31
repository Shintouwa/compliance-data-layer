/**
 * The module-boundary rule, as an executable test.
 * architecture.md Part I §1.3.
 *
 * > `app/` contains routes only — parse params, call one module function,
 * > render. No business logic, no database queries.
 * >
 * > Each `modules/<name>/` exposes a single `index.ts` barrel. **Cross-module
 * > imports go through the barrel only.** This is what lets an agent load three
 * > files instead of thirty.
 *
 * §1.3 names eslint-plugin-boundaries. See the note in `/eslint.config.mjs` for
 * why it is not the enforcement here: at v7.1.0 it classified none of this
 * repository's files and reported nothing on a deliberate violation.
 *
 * **The self-test below runs first, deliberately.** A checker that silently
 * matches nothing is exactly the failure this file exists to prevent, so it
 * proves it can fail before it is trusted to pass.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = fileURLToPath(new URL('.', import.meta.url));
const REPO_PREFIX = 'apps/web/';

interface SourceFile {
  /** Repo-relative, POSIX separators. e.g. `apps/web/modules/audit/validate.ts`. */
  readonly path: string;
  readonly source: string;
}

/* -------------------------------------------------------------------------- */
/* The checker                                                                 */
/* -------------------------------------------------------------------------- */

const FROM_IMPORT = /from\s+['"]([^'"]+)['"]/g;
const BARE_IMPORT = /import\s+['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const pattern of [FROM_IMPORT, BARE_IMPORT, DYNAMIC_IMPORT]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null = pattern.exec(source);
    while (match !== null) {
      if (match[1] !== undefined) out.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return out;
}

/** Repo-relative target, or null for an external package. */
function resolveSpecifier(fromPath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return `${REPO_PREFIX}${specifier.slice(2)}`;
  if (!specifier.startsWith('.')) return null;
  const dir = posix.dirname(fromPath);
  return posix.normalize(posix.join(dir, specifier));
}

/** `apps/web/modules/audit/validate.ts` → `audit`. Anything else → null. */
function moduleOf(path: string): string | null {
  const match = /^apps\/web\/modules\/([^/]+)\//.exec(path);
  return match?.[1] ?? null;
}

const stripExtension = (path: string): string => path.replace(/\.(ts|tsx)$/, '');

export function boundaryViolations(files: readonly SourceFile[]): string[] {
  const problems: string[] = [];

  for (const file of files) {
    const owner = moduleOf(file.path);

    for (const specifier of specifiers(file.source)) {
      const target = resolveSpecifier(file.path, specifier);
      if (target === null) continue;

      const targetModule = moduleOf(`${target}/`) ?? moduleOf(target);

      // 1. A module may only be entered through its barrel. `../tenancy` and
      //    `../tenancy/index` both name it; anything deeper does not.
      if (targetModule !== null && targetModule !== owner) {
        const root = `apps/web/modules/${targetModule}`;
        const entered = stripExtension(target);
        if (entered !== root && entered !== `${root}/index`) {
          problems.push(
            `${file.path} imports "${specifier}" — a private file of module ` +
              `"${targetModule}". Cross-module imports go through ` +
              `modules/${targetModule}/index.ts only. §1.3.`,
          );
        }
      }

      // 2. Dependencies run one way: jobs and routes orchestrate modules;
      //    a module never reaches back into either.
      if (owner !== null
        && (target.startsWith('apps/web/jobs/') || target.startsWith('apps/web/app/'))) {
        problems.push(
          `${file.path} imports "${specifier}". A module must not depend on ` +
            `${target.startsWith('apps/web/jobs/') ? 'jobs/' : 'app/'} — the ` +
            'dependency runs the other way. §1.3.',
        );
      }
    }
  }

  return problems;
}

/* -------------------------------------------------------------------------- */

function collect(dir: string, acc: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(full, acc);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      acc.push({
        path: `${REPO_PREFIX}${relative(WEB_ROOT, full).split(sep).join('/')}`,
        source: readFileSync(full, 'utf8'),
      });
    }
  }
  return acc;
}

describe('the checker itself', () => {
  it('flags a deep import into another module', () => {
    const problems = boundaryViolations([{
      path: 'apps/web/modules/audit/validate.ts',
      source: "import { openBlob } from '../ingestion/crypto';",
    }]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('private file of module "ingestion"');
  });

  it('flags a deep import through the @/ alias', () => {
    expect(boundaryViolations([{
      path: 'apps/web/jobs/handlers/x.ts',
      source: "import { sealBlob } from '@/modules/ingestion/crypto';",
    }])).toHaveLength(1);
  });

  it('flags a module importing jobs', () => {
    const problems = boundaryViolations([{
      path: 'apps/web/modules/audit/validate.ts',
      source: "import { JOB } from '../../jobs/registry';",
    }]);
    expect(problems.some((p) => p.includes('the dependency runs the other way'))).toBe(true);
  });

  it('allows the barrel, intra-module files, lib and external packages', () => {
    expect(boundaryViolations([{
      path: 'apps/web/modules/audit/validate.ts',
      source: [
        "import { toUbl } from '../mapping';",
        "import { recurrenceKey } from '../corpus';",
        "import { docHash } from './score';",
        "import { logger } from '../../lib/logger';",
        "import { z } from 'zod';",
        "import { invoice } from '@repo/db/schema/client-data';",
      ].join('\n'),
    }])).toEqual([]);
  });
});

describe('apps/web', () => {
  it('respects the module boundary', () => {
    // This file is excluded from its own scan: the fixtures above are import
    // statements inside string literals, and the checker reads source text
    // rather than a parsed module graph, so it cannot tell them apart. It is
    // the ONLY exclusion — a second one would be a way to opt out of the rule.
    const files = collect(WEB_ROOT).filter((f) => f.path !== 'apps/web/architecture.test.ts');
    expect(boundaryViolations(files)).toEqual([]);
  });

  it('scans a meaningful number of files', () => {
    // A checker that silently matches nothing passes every assertion above.
    expect(collect(WEB_ROOT).length).toBeGreaterThan(30);
  });
});
