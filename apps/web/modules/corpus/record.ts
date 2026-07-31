/**
 * All `corpus.*` writes. architecture.md Part I §2.9, Part IV §4 job 5.
 *
 * **Rule 1 — never store commercial content.** No amounts, names, addresses,
 * line descriptions, or TRNs. Only `value_shape`. This is the difference
 * between a dataset you can legally aggregate, share and sell, and a liability
 * that makes the company unacquirable.
 *
 * Connects as `corpus_writer` through `CORPUS_DATABASE_URL` — the only place in
 * the system that does. Every other job uses `app_user`, which has no `INSERT`
 * on `corpus`.
 */

import { inArray } from 'drizzle-orm';
import { corpusDb } from '@repo/db/corpus-connection';
import {
  corpusCounterparty, corpusDocument, corpusEntity, corpusTenant, rule, sourceSystem,
  specification, validationEvent,
} from '@repo/db/schema/corpus';
import type { ValidationStage } from '@repo/db/schema/corpus';
import type { FailureClass, FlowDirection, ValueShape } from '@repo/db/schema/_shared';
import { assertRedacted } from './assert-redacted';
import { lineCountBucket, recurrenceKey } from './recurrence';

/** One finding as it arrives from the sidecar, plus the document it belongs to. */
export interface CorpusFindingInput {
  readonly docHash: string;
  readonly stage: ValidationStage;
  readonly outcome: 'pass' | 'fail' | 'warn';
  readonly rule_id: string | null;
  readonly business_term: string | null;
  readonly xpath: string | null;
  readonly failure_class: FailureClass | null;
  readonly value_shape: ValueShape | null;
  readonly message?: string | undefined;
  readonly attempt?: number | undefined;
}

export interface CorpusDocumentInput {
  readonly docHash: string;
  readonly docType: string;
  readonly scenario: string;
  readonly currency: string;
  readonly lineCount: number;
  readonly hasAllowanceCharge: boolean;
  readonly hasMultiTaxRate: boolean;
  readonly counterpartyHash?: string | undefined;
}

export interface RecordCorpusInput {
  readonly tenantHash: string;
  readonly entityHash: string;
  readonly jurisdiction: string;
  readonly country: string;
  readonly sectorCode: string | null;
  readonly sizeBand: string | null;
  readonly scenarioProfile: unknown;
  readonly sysId: string | null;
  readonly direction: FlowDirection;
  readonly specId: string;
  readonly specName: string;
  readonly specVersion: string;
  readonly rulesetHash: string;
  readonly documents: readonly CorpusDocumentInput[];
  readonly findings: readonly CorpusFindingInput[];
  readonly counterpartyHash?: string | undefined;
}

/**
 * Thrown when a finding names a rule that is not in `corpus.rule`.
 *
 * NOT an `UnrecoverableError`. `corpus.record` retries infinitely by design
 * (Part IV §1) because losing corpus data is the only truly unrecoverable
 * failure in this system, so the retry queue holds the payload until the spec
 * catalogue is seeded and then writes it correctly.
 *
 * The alternative — writing the event with `rule_id = NULL` — would be a
 * permanently degraded row in an append-only table: no UPDATE can ever repair
 * it, and the failure→fix join in §2.9 is exactly what the corpus is for.
 */
export class SpecCatalogueIncomplete extends Error {
  public override readonly name = 'SpecCatalogueIncomplete';
}

export interface RecordCorpusResult {
  readonly eventsWritten: number;
  readonly documentsWritten: number;
}

export async function recordCorpus(input: RecordCorpusInput): Promise<RecordCorpusResult> {
  // Redaction backstop BEFORE anything is opened — a Sev-1 must not leave a
  // half-written transaction behind to reason about. Part IV §6.
  for (const f of input.findings) {
    assertRedacted(f.message === undefined
      ? { value_shape: f.value_shape }
      : { value_shape: f.value_shape, message: f.message });
  }

  const byHash = new Map(input.documents.map((d) => [d.docHash, d]));
  for (const f of input.findings) {
    if (!byHash.has(f.docHash)) {
      throw new Error(
        `Finding references doc_hash ${f.docHash}, which is not in the documents list. ` +
          'corpus.validation_event.doc_hash is a foreign key to corpus.document.',
      );
    }
  }

  return corpusDb.transaction(async (tx) => {
    // Dimension upserts. INSERT-or-nothing never updates, so the append-only
    // trigger is not tripped. **Do not "improve" to onConflictDoUpdate.**
    await tx.insert(specification).values({
      specId: input.specId,
      jurisdiction: input.jurisdiction,
      name: input.specName,
      version: input.specVersion,
      effectiveFrom: new Date(),
    }).onConflictDoNothing();

    if (input.sysId !== null) {
      await tx.insert(sourceSystem).values({
        sysId: input.sysId,
        vendor: input.sysId,
        product: input.sysId,
      }).onConflictDoNothing();
    }

    await tx.insert(corpusTenant).values({
      tenantHash: input.tenantHash,
      sectorCode: input.sectorCode,
      sizeBand: input.sizeBand,
      country: input.country,
    }).onConflictDoNothing();

    await tx.insert(corpusEntity).values({
      entityHash: input.entityHash,
      tenantHash: input.tenantHash,
      jurisdiction: input.jurisdiction,
      sysId: input.sysId,
      entitySizeBand: input.sizeBand,
      scenarioProfile: input.scenarioProfile,
    }).onConflictDoNothing();

    if (input.counterpartyHash !== undefined) {
      await tx.insert(corpusCounterparty).values({
        counterpartyHash: input.counterpartyHash,
        jurisdiction: input.jurisdiction,
        sizeBand: null,
        sectorCode: null,
      }).onConflictDoNothing();
    }

    if (input.documents.length > 0) {
      await tx.insert(corpusDocument).values(input.documents.map((d) => ({
        docHash: d.docHash,
        entityHash: input.entityHash,
        counterpartyHash: d.counterpartyHash ?? input.counterpartyHash ?? null,
        direction: input.direction,
        docType: d.docType,
        scenario: d.scenario,
        currency: d.currency,
        lineCountBucket: lineCountBucket(d.lineCount),
        hasAllowanceCharge: d.hasAllowanceCharge,
        hasMultiTaxRate: d.hasMultiTaxRate,
      }))).onConflictDoNothing();
    }

    await assertRulesKnown(tx, input.findings);

    for (const f of input.findings) {
      await tx.insert(validationEvent).values({
        docHash: f.docHash,
        entityHash: input.entityHash,
        direction: input.direction,
        specId: input.specId,
        specVersion: input.specVersion,
        rulesetHash: input.rulesetHash,
        stage: f.stage,
        validator: 'own_schematron',
        outcome: f.outcome,
        ruleId: f.rule_id,
        businessTerm: f.business_term,
        xpath: f.xpath,
        failureClass: f.failure_class,
        valueShape: f.value_shape,
        attemptNumber: f.attempt ?? 1,
        recurrenceKey: recurrenceKey(input.entityHash, f.rule_id, f.xpath, f.value_shape),
      });
    }

    return {
      eventsWritten: input.findings.length,
      documentsWritten: input.documents.length,
    };
  });
}

type CorpusTx = Parameters<Parameters<typeof corpusDb.transaction>[0]>[0];

async function assertRulesKnown(
  tx: CorpusTx,
  findings: readonly CorpusFindingInput[],
): Promise<void> {
  const referenced = [...new Set(
    findings.map((f) => f.rule_id).filter((id): id is string => id !== null),
  )];
  if (referenced.length === 0) return;

  const known = await tx.select({ ruleId: rule.ruleId }).from(rule)
    .where(inArray(rule.ruleId, referenced));
  const knownIds = new Set(known.map((r) => r.ruleId));
  const missing = referenced.filter((id) => !knownIds.has(id));

  if (missing.length > 0) {
    throw new SpecCatalogueIncomplete(
      `corpus.rule has no row for: ${missing.join(', ')}. The spec catalogue must be ` +
        'seeded from the published Schematron before validation events referencing ' +
        'those rules can be recorded — see seedSpecCatalogue(). This job retries ' +
        'infinitely by design, so nothing is lost; seed the catalogue and it lands. ' +
        'architecture.md Part I §2.9, Part IV §1.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Spec catalogue seeding                                                      */
/* -------------------------------------------------------------------------- */

export interface SpecCatalogueRule {
  readonly ruleId: string;
  readonly nativeRuleCode: string;
  readonly severity: 'fatal' | 'error' | 'warning';
  readonly businessTerm: string | null;
  readonly xpathContext: string | null;
  readonly failureClass: FailureClass;
  /**
   * The PUBLISHED specification assert text. Not client data — safe to store,
   * and required by the Exception Inbox detail pane (Part III §2.1).
   *
   * Required, not optional: `canonical_text_hash` is its sha256 and exists to
   * detect silent upstream rule edits between versions. `corpus` is
   * append-only, so a row seeded with a placeholder can never be corrected.
   */
  readonly assertText: string;
}

export interface SeedSpecCatalogueInput {
  readonly specId: string;
  readonly specName: string;
  readonly jurisdiction: string;
  readonly version: string;
  readonly effectiveFrom: Date;
  readonly rules: readonly SpecCatalogueRule[];
}

/**
 * Seeds `corpus.specification` and `corpus.rule`.
 *
 * Separate from the pipeline on purpose: rules are published specification
 * metadata, not run data, and they must be right the first time — `corpus` is
 * append-only and there is no second chance to correct a row.
 */
export async function seedSpecCatalogue(input: SeedSpecCatalogueInput): Promise<number> {
  const { createHash } = await import('node:crypto');
  return corpusDb.transaction(async (tx) => {
    await tx.insert(specification).values({
      specId: input.specId,
      jurisdiction: input.jurisdiction,
      name: input.specName,
      version: input.version,
      effectiveFrom: input.effectiveFrom,
    }).onConflictDoNothing();

    if (input.rules.length === 0) return 0;

    await tx.insert(rule).values(input.rules.map((r) => ({
      ruleId: r.ruleId,
      specId: input.specId,
      nativeRuleCode: r.nativeRuleCode,
      severity: r.severity,
      businessTerm: r.businessTerm,
      xpathContext: r.xpathContext,
      failureClass: r.failureClass,
      assertText: r.assertText,
      canonicalTextHash: `sha256:${createHash('sha256').update(r.assertText).digest('hex')}`,
    }))).onConflictDoNothing();

    return input.rules.length;
  });
}
