-- packages/db/policies/001_roles_and_grants.sql
--
-- 🔒 HUMAN-OWNED — CLAUDE.md §4.3. Review as SQL, not as TypeScript.
-- architecture.md Part I §2.2.
--
-- Three roles, three connection strings. **This separation is what makes the
-- append-only guarantee real rather than aspirational.**
--
--   DATABASE_URL            app_user            web app + every job EXCEPT corpus.record
--   CORPUS_DATABASE_URL     corpus_writer       corpus.record ONLY
--   ANALYTICS_DATABASE_URL  readonly_analytics  dashboard moat block, benchmarking
--
-- **Do not consolidate these.** An agent that does has removed the guarantee.
--
-- Re-applied by `make migrate` after EVERY migration (§2.10): `GRANT … ON ALL
-- TABLES` binds only the tables that exist when it runs, so a table added by
-- Drizzle is ungranted until this file re-runs. That is why every statement
-- below is idempotent.
--
-- Passwords are psql variables, never literals in the repository:
--
--   psql "$DATABASE_URL" \
--     -v app_user_pw="$APP_USER_PW" \
--     -v corpus_writer_pw="$CORPUS_WRITER_PW" \
--     -v analytics_pw="$ANALYTICS_PW" \
--     -f packages/db/policies/001_roles_and_grants.sql
--
-- Where the roles are provisioned outside SQL (the Neon console or API manages
-- them, which is the normal case for a Neon project), the variables may be
-- empty: an existing role is then left untouched and only the grants are
-- re-applied. A MISSING role with no password is a hard error, not a skip —
-- silently continuing would leave the database with one role and no separation.

\set ON_ERROR_STOP on

-- Undefined psql variables would abort with `"app_user_pw" is not defined`
-- several statements before the message that explains what to do about it.
\if :{?app_user_pw}
\else
  \set app_user_pw ''
\endif
\if :{?corpus_writer_pw}
\else
  \set corpus_writer_pw ''
\endif
\if :{?analytics_pw}
\else
  \set analytics_pw ''
\endif

CREATE OR REPLACE FUNCTION pg_temp.ensure_login_role(role_name text, pw text)
RETURNS void AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
    IF pw <> '' THEN
      EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', role_name, pw);
    END IF;
  ELSE
    IF pw = '' THEN
      RAISE EXCEPTION
        'Role % does not exist and no password was supplied. Re-run with '
        '-v <role>_pw=… or provision the role in the Neon console first. '
        'architecture.md Part I §2.2 requires three separate roles; continuing '
        'with fewer would remove the least-privilege and append-only guarantees.',
        role_name;
    END IF;
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', role_name, pw);
  END IF;
END $$ LANGUAGE plpgsql;

SELECT pg_temp.ensure_login_role('app_user',           :'app_user_pw');
SELECT pg_temp.ensure_login_role('corpus_writer',      :'corpus_writer_pw');
SELECT pg_temp.ensure_login_role('readonly_analytics', :'analytics_pw');

-- pg-boss creates its own schema and tables at runtime, as app_user, and
-- therefore owns them. Creating the schema here means the GRANT below has
-- something to bind to on a fresh database; CREATE on the schema is what lets
-- pg-boss install itself. Part I §1.7.
CREATE SCHEMA IF NOT EXISTS pgboss;

-- ---------------------------------------------------------------------------
-- app_user — the web app and all jobs except corpus.record
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA app, client_data, pgboss TO app_user;
GRANT CREATE ON SCHEMA pgboss TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA app, client_data, pgboss TO app_user;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA app, client_data, pgboss TO app_user;
GRANT USAGE  ON SCHEMA corpus TO app_user;
GRANT SELECT ON ALL TABLES IN SCHEMA corpus TO app_user;

-- ---------------------------------------------------------------------------
-- corpus_writer — corpus.record ONLY. No access to app or client_data at all.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA corpus TO corpus_writer;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA corpus TO corpus_writer;

-- ---------------------------------------------------------------------------
-- readonly_analytics — dashboard moat block, benchmarking, supplier scoring
-- ---------------------------------------------------------------------------
GRANT USAGE  ON SCHEMA corpus TO readonly_analytics;
GRANT SELECT ON ALL TABLES IN SCHEMA corpus TO readonly_analytics;

-- ---------------------------------------------------------------------------
-- The append-only guarantee, permission layer. §2.7 adds the trigger layer;
-- belt AND braces, because the REVOKE stops the common case and the trigger
-- catches anything run as superuser or by a future role.
-- ---------------------------------------------------------------------------
REVOKE UPDATE, DELETE ON ALL TABLES IN SCHEMA corpus FROM app_user, corpus_writer;

-- Neither of the corpus-side roles may reach client data. Postgres grants
-- nothing on a new schema by default, so this is belt-and-braces against a
-- future GRANT … TO PUBLIC.
REVOKE ALL ON SCHEMA app, client_data FROM corpus_writer, readonly_analytics;
