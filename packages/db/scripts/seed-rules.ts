/**
 * Seed `corpus.specification` and `corpus.rule` from the vendored Schematron.
 *
 * `corpus.record` refuses to write a `validation_event` naming a rule that is
 * not in `corpus.rule` (`SpecCatalogueIncomplete`, apps/web/modules/corpus/
 * record.ts). That queue retries infinitely by design, so nothing is lost while
 * the catalogue is empty — but nothing lands either. This script is what makes
 * it land.
 *
 * Run:
 *
 *   pnpm --filter @repo/db seed:rules              # dry run, prints the plan
 *   pnpm --filter @repo/db seed:rules -- --commit  # writes
 *
 * Dry by default because `corpus` is APPEND-ONLY. There is no UPDATE and no
 * DELETE — `002_corpus_append_only.sql` raises on both — so a row seeded with a
 * wrong `failure_class` or a wrong `canonical_text_hash` is wrong forever.
 * `--commit` should be typed by someone who has read the plan.
 *
 * Connects as `corpus_writer` via `CORPUS_DATABASE_URL`, the only role with
 * INSERT on `corpus` (Part I §2.2).
 *
 * ---
 *
 * WHICH SCHEMATRON — read this before pointing it at `published/`
 *
 * It seeds the rulesets each profile's registry entry DECLARES, which today are
 * the agent-authored provisional ones. It deliberately does NOT seed
 * `specs/<profile>/published/`, and that is not an oversight:
 *
 * 1. **Those are not the rule ids the sidecar emits.** The engine executes what
 *    `specs/registry/<profile>.json` lists under `schematron`, and the published
 *    rulesets are not wired in — they are refused at load with
 *    `SchematronUnsupportedError` (`specs/ENGINE-SVRL-MIGRATION.md`). Seeding
 *    `BR-01` and `ibr-076` would leave `corpus.record` just as blocked, because
 *    every finding still names `CDL-PROV-###`.
 *
 * 2. **`corpus.rule.failure_class` is NOT NULL and the published rulesets do
 *    not carry it.** Measured: zero `cdl:failure-class` attributes across
 *    `pint-ae/published/` and `en16931/published/`. Supplying it for the 1,442
 *    published rules means classifying each one by hand, which `specs/RULES.md`
 *    identifies as an act of tax-rule interpretation that CLAUDE.md §4.4
 *    forbids and that `specs/**` is 🔒 to prevent.
 *
 * So the guard below refuses any assertion without `cdl:failure-class` instead
 * of defaulting one. Point this script at a published ruleset and it stops with
 * the rule id that has no class — which is the correct answer until the SVRL
 * migration lands, at which point this script starts seeding the real ids with
 * no change beyond the registry's `schematron` list.
 *
 * A quarantined profile (`unavailable` in its registry entry) is skipped
 * entirely. Seeding rules for a profile that cannot execute writes permanent
 * rows asserting a capability the system does not have.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { corpusDb } from '../corpus-connection';
import { rule, specification } from '../schema/corpus';
import { FAILURE_CLASSES, SEVERITIES } from '../schema/_shared';
import type { FailureClass } from '../schema/_shared';

/* -------------------------------------------------------------------------- */
/* Locations                                                                   */
/* -------------------------------------------------------------------------- */

const SPECS_DIR = new URL('../../../apps/validator/src/validator/specs/', import.meta.url);
const REGISTRY_DIR = new URL('registry/', SPECS_DIR);

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

export interface RegistryEntry {
  readonly specId: string;
  readonly jurisdiction: string;
  readonly version: string;
  readonly schematron: readonly string[];
  /** Present when the human lead has quarantined the profile. */
  readonly unavailable?: string;
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** Zod is not a dependency of this package; the shape is checked by hand. */
function asRegistryEntry(raw: unknown, file: string): RegistryEntry {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${file}: not a JSON object.`);
  }
  const r = raw as Record<string, unknown>;
  const str = (key: string): string => {
    const value = r[key];
    if (typeof value !== 'string' || value === '') {
      throw new Error(`${file}: "${key}" must be a non-empty string.`);
    }
    return value;
  };
  const schematron = r.schematron;
  if (!isStringArray(schematron)) {
    throw new Error(`${file}: "schematron" must be an array of paths.`);
  }
  const unavailable = r.unavailable;
  return {
    specId: str('spec_id'),
    jurisdiction: str('jurisdiction'),
    version: str('version'),
    schematron,
    ...(typeof unavailable === 'string' ? { unavailable } : {}),
  };
}

export function readRegistry(): RegistryEntry[] {
  const dir = fileURLToPath(REGISTRY_DIR);
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  if (files.length === 0) {
    throw new Error(`No registry entries under ${dir}. Nothing to seed; refusing to guess.`);
  }
  return files.map((f) =>
    asRegistryEntry(JSON.parse(readFileSync(new URL(f, REGISTRY_DIR), 'utf8')), f));
}

/* -------------------------------------------------------------------------- */
/* Schematron extraction                                                       */
/* -------------------------------------------------------------------------- */

export interface ExtractedRule {
  readonly ruleId: string;
  readonly nativeRuleCode: string;
  readonly severity: 'fatal' | 'error' | 'warning';
  readonly businessTerm: string | null;
  readonly xpathContext: string | null;
  readonly failureClass: FailureClass;
  readonly assertText: string;
  readonly canonicalTextHash: string;
  /** The `schematron` path it came from, e.g. `pint-ae/PINT-AE.sch`. */
  readonly source: string;
}

/**
 * `removeNSPrefix` so `<sch:assert>` and a default-namespaced `<assert>` parse
 * the same way, and so `cdl:failure-class` arrives as `failure-class`. The
 * provisional and published distributions differ on exactly this, and the
 * script has to survive the day one replaces the other.
 *
 * `preserveOrder` keeps the element tree walkable, which is what lets an
 * assertion be associated with the `context` of the `<rule>` enclosing it.
 */
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  preserveOrder: true,
  trimValues: false,
  // An id like `01` must stay a string. Number coercion on attributes is how a
  // rule id silently becomes 1 and stops matching anything the sidecar emits.
  parseAttributeValue: false,
  parseTagValue: false,
});

type OrderedNode = Record<string, unknown> & { ':@'?: Record<string, unknown> };

const attrs = (node: OrderedNode): Record<string, unknown> => node[':@'] ?? {};

function attr(node: OrderedNode, name: string): string | null {
  const value = attrs(node)[`@_${name}`];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Element name of an ordered node — the single key that is not `:@`. */
function tagOf(node: OrderedNode): string | undefined {
  return Object.keys(node).find((k) => k !== ':@');
}

/** Concatenated text, matching the engine's `itertext()`. */
function textOf(node: OrderedNode): string {
  const tag = tagOf(node);
  if (tag === undefined) return '';
  if (tag === '#text') return String(node[tag]);
  const children = node[tag];
  if (!Array.isArray(children)) return '';
  return (children as OrderedNode[]).map(textOf).join('');
}

export class UnseedableRule extends Error {
  public override readonly name = 'UnseedableRule';
}

/**
 * Every `<assert>` and `<report>` in one Schematron file.
 *
 * The attribute names and the severity default mirror `_compile_assertion` in
 * apps/validator/src/validator/engine.py 🔒 — if the two disagree, the corpus
 * describes rules the sidecar did not run.
 */
export function extractRules(xml: string, source: string): ExtractedRule[] {
  const out: ExtractedRule[] = [];

  const walk = (nodes: readonly OrderedNode[], context: string | null): void => {
    for (const node of nodes) {
      const tag = tagOf(node);
      if (tag === undefined || tag === '#text') continue;

      const nextContext = tag === 'rule' ? attr(node, 'context') ?? context : context;
      if (tag === 'assert' || tag === 'report') {
        out.push(toRule(node, nextContext, source));
      }

      const children = node[tag];
      if (Array.isArray(children)) walk(children as OrderedNode[], nextContext);
    }
  };

  walk(parser.parse(xml) as OrderedNode[], null);
  return out;
}

function toRule(node: OrderedNode, context: string | null, source: string): ExtractedRule {
  const ruleId = attr(node, 'id');
  if (ruleId === null) {
    throw new UnseedableRule(
      `${source}: an <${tagOf(node) ?? '?'}> has no @id. The corpus keys on the rule id; ` +
        'an anonymous assertion cannot be recorded against a finding.',
    );
  }

  // `@flag` defaults to "error" — engine.py `_narrow_severity`.
  const flag = attr(node, 'flag') ?? 'error';
  if (!(SEVERITIES as readonly string[]).includes(flag)) {
    throw new UnseedableRule(
      `${source}: ${ruleId} has @flag="${flag}"; expected one of ${SEVERITIES.join(', ')}.`,
    );
  }

  const failureClass = attr(node, 'failure-class');
  if (failureClass === null) {
    throw new UnseedableRule(
      `${source}: ${ruleId} has no cdl:failure-class, and corpus.rule.failure_class is ` +
        'NOT NULL. It is NOT defaulted here: choosing a class for a published rule is ' +
        'interpreting what that rule is about, which CLAUDE.md §4.4 forbids, and corpus ' +
        'is append-only so a guess cannot be corrected. If this is a published ruleset, ' +
        'it is not seedable until the ENGINE-SVRL-MIGRATION work lands — see the header ' +
        'of this file.',
    );
  }
  if (!(FAILURE_CLASSES as readonly string[]).includes(failureClass)) {
    throw new UnseedableRule(
      `${source}: ${ruleId} has cdl:failure-class="${failureClass}", which is not one of ` +
        `the ten in architecture.md Part I §2.3 (${FAILURE_CLASSES.join(', ')}).`,
    );
  }

  const assertText = textOf(node).trim();
  if (assertText === '') {
    throw new UnseedableRule(
      `${source}: ${ruleId} has no assertion text. canonical_text_hash is its sha256 and ` +
        'exists to detect a silent upstream rule edit; hashing the empty string detects ' +
        'nothing, and the Exception Inbox has nothing to show.',
    );
  }

  return {
    ruleId,
    // `cdl:native-code` when the ruleset declares one. The provisional rulesets
    // do not: their id IS the native code, and RULES.md is explicit that the
    // published counterpart is known for only two of them and must not be
    // guessed for the rest. Writing a published code we do not execute into an
    // append-only table is the confusion CDL-PROV namespacing exists to stop.
    nativeRuleCode: attr(node, 'native-code') ?? ruleId,
    severity: flag as 'fatal' | 'error' | 'warning',
    businessTerm: attr(node, 'business-term'),
    xpathContext: context,
    failureClass: failureClass as FailureClass,
    assertText,
    canonicalTextHash: `sha256:${createHash('sha256').update(assertText).digest('hex')}`,
    source,
  };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                    */
/* -------------------------------------------------------------------------- */

export interface SeedPlan {
  readonly specifications: readonly {
    specId: string; jurisdiction: string; name: string; version: string;
  }[];
  readonly rules: readonly (ExtractedRule & { specId: string })[];
  readonly skipped: readonly { specId: string; reason: string }[];
}

/**
 * A rule belongs to the spec whose DIRECTORY holds its file, not to every
 * profile that includes that file. `pint-ae` declares both `pint-ae/PINT-AE.sch`
 * and `en16931/EN16931-UBL-model.sch`; the second one's rules are EN 16931's,
 * and `corpus.rule.rule_id` is a primary key that can only say so once.
 *
 * `corpus.validation_event` carries the profile separately, so an event can
 * correctly read "validated under pint-ae, rule CDL-PROV-001 (en16931) fired".
 */
function owningSpecOf(schematronPath: string): string {
  const owner = schematronPath.split('/')[0];
  if (owner === undefined || owner === '' || owner === schematronPath) {
    throw new Error(
      `Schematron path "${schematronPath}" has no leading profile directory, so the ` +
        'spec that owns its rules cannot be determined. Refusing to guess.',
    );
  }
  return owner;
}

export function buildPlan(entries: readonly RegistryEntry[], read: (p: string) => string): SeedPlan {
  const byId = new Map(entries.map((e) => [e.specId, e]));
  const skipped: { specId: string; reason: string }[] = [];
  const owners = new Set<string>();
  const seenFiles = new Set<string>();
  const rules: (ExtractedRule & { specId: string })[] = [];

  for (const entry of entries) {
    if (entry.unavailable !== undefined) {
      skipped.push({ specId: entry.specId, reason: entry.unavailable });
      continue;
    }

    for (const path of entry.schematron) {
      const owner = owningSpecOf(path);
      const ownerEntry = byId.get(owner);
      if (ownerEntry === undefined) {
        throw new Error(
          `${entry.specId} declares "${path}", but there is no registry entry for "${owner}". ` +
            'corpus.rule.spec_id is a foreign key to corpus.specification; the owning spec ' +
            'must exist before its rules can be recorded.',
        );
      }
      if (ownerEntry.unavailable !== undefined) {
        // Reachable only if a live profile includes a quarantined profile's
        // ruleset. Loud, because it means the quarantine is not holding.
        throw new Error(
          `${entry.specId} declares "${path}", whose owning spec "${owner}" is quarantined: ` +
            ownerEntry.unavailable,
        );
      }

      owners.add(owner);
      if (seenFiles.has(path)) continue;   // shared file, declared by two profiles
      seenFiles.add(path);
      for (const extracted of extractRules(read(path), path)) {
        rules.push({ ...extracted, specId: owner });
      }
    }
  }

  const duplicates = rules
    .map((r) => r.ruleId)
    .filter((id, i, all) => all.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate rule ids across rulesets: ${[...new Set(duplicates)].join(', ')}. ` +
        'corpus.rule.rule_id is a primary key, and two different assertions sharing one ' +
        'id would make every finding naming it ambiguous.',
    );
  }

  const specifications = [...owners].sort().map((specId) => {
    const entry = byId.get(specId);
    if (entry === undefined) throw new Error(`No registry entry for "${specId}".`);
    return {
      specId,
      jurisdiction: entry.jurisdiction,
      // The registry declares no display name. `validate.run` already writes
      // the profile id into corpus.specification.name; matching it keeps the
      // two writers from producing different rows for one spec.
      name: specId,
      version: entry.version,
    };
  });

  return { specifications, rules, skipped };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export interface SeedOutcome {
  readonly specificationsInserted: number;
  readonly rulesInserted: number;
}

/**
 * `onConflictDoNothing` on both tables, so the script is idempotent and safe to
 * re-run. INSERT-or-nothing never UPDATEs, which is also what keeps it clear of
 * the `corpus_append_only` trigger — do not "improve" either to
 * `onConflictDoUpdate`.
 *
 * `effectiveFrom` is the catalogue load time. ⚠️ It is NOT a published
 * effective date: no ruleset here declares one, and every `version` is still
 * the `RESOLVE_IN_WEEK_1` sentinel. Resolve both together.
 */
export async function applyPlan(plan: SeedPlan, effectiveFrom: Date): Promise<SeedOutcome> {
  return corpusDb.transaction(async (tx) => {
    const specs = await tx.insert(specification)
      .values(plan.specifications.map((s) => ({ ...s, effectiveFrom })))
      .onConflictDoNothing()
      .returning({ specId: specification.specId });

    if (plan.rules.length === 0) {
      return { specificationsInserted: specs.length, rulesInserted: 0 };
    }

    const inserted = await tx.insert(rule)
      .values(plan.rules.map((r) => ({
        ruleId: r.ruleId,
        specId: r.specId,
        nativeRuleCode: r.nativeRuleCode,
        severity: r.severity,
        businessTerm: r.businessTerm,
        xpathContext: r.xpathContext,
        failureClass: r.failureClass,
        assertText: r.assertText,
        canonicalTextHash: r.canonicalTextHash,
      })))
      .onConflictDoNothing()
      .returning({ ruleId: rule.ruleId });

    return { specificationsInserted: specs.length, rulesInserted: inserted.length };
  });
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

async function main(argv: readonly string[]): Promise<number> {
  const commit = argv.includes('--commit');
  const entries = readRegistry();
  const plan = buildPlan(entries, (p) => readFileSync(new URL(p, SPECS_DIR), 'utf8'));

  for (const { specId, reason } of plan.skipped) {
    console.log(`SKIP  ${specId} — quarantined: ${reason.slice(0, 160)}…`);
  }
  for (const spec of plan.specifications) {
    console.log(`SPEC  ${spec.specId}  jurisdiction=${spec.jurisdiction}  version=${spec.version}`);
  }
  for (const r of plan.rules) {
    console.log(
      `RULE  ${r.ruleId.padEnd(14)} ${r.specId.padEnd(15)} ${r.severity.padEnd(8)}` +
      `${r.failureClass.padEnd(24)} ${r.businessTerm ?? '-'}`,
    );
  }
  console.log(
    `\n${String(plan.specifications.length)} specification(s), ` +
    `${String(plan.rules.length)} rule(s), ${String(plan.skipped.length)} profile(s) skipped.`,
  );

  if (!commit) {
    console.log('\nDRY RUN — nothing written. Re-run with --commit to insert.');
    console.log('corpus is append-only: a wrong row here cannot be corrected later.');
    return 0;
  }

  const outcome = await applyPlan(plan, new Date());
  console.log(
    `\nCOMMITTED — ${String(outcome.specificationsInserted)} specification row(s) and ` +
    `${String(outcome.rulesInserted)} rule row(s) inserted ` +
    '(rows already present are left untouched).',
  );
  return 0;
}

/* Guarded so the pure functions above can be imported by seed-rules.test.ts. */
const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => { process.exit(code); })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      process.exit(1);
    });
}
