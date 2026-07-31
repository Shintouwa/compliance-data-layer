-- packages/db/policies/002_corpus_append_only.sql
--
-- 🔒 HUMAN-OWNED — CLAUDE.md §4.3. Review as SQL, not as TypeScript.
-- architecture.md Part I §2.7.
--
-- An agent will eventually write an UPDATE against the corpus. **Make the
-- database refuse it loudly.**
--
-- A rule that silently discards the write (`DO INSTEAD NOTHING`) is worse than
-- no protection: it converts a visible failure into an invisible one, the exact
-- inverse of §1.1. CLAUDE.md §4.6 names this specifically.
--
-- Re-applied by `make migrate` after EVERY migration (§2.10): a corpus table
-- added by Drizzle has no trigger until this file re-runs. CI asserts coverage
-- independently — scripts/assert-corpus-triggers.sh.
--
-- `INSERT … ON CONFLICT DO NOTHING` is safe: it inserts or does nothing, never
-- updates, so it does not trip the trigger.

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION corpus.reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'corpus is append-only: % attempted on %', TG_OP, TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'corpus'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS corpus_append_only ON corpus.%I;', t);
    EXECUTE format($f$
      CREATE TRIGGER corpus_append_only
        BEFORE UPDATE OR DELETE ON corpus.%I
        FOR EACH ROW EXECUTE FUNCTION corpus.reject_mutation();
    $f$, t);
  END LOOP;
END $$;

REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA corpus FROM app_user, corpus_writer;
