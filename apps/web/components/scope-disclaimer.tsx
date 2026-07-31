/**
 * The scope disclaimer. architecture.md Part III §1.5.
 *
 * **Mandatory, verbatim, on every report.** CLAUDE.md §4.5: give tax advice,
 * anywhere, ever — never.
 *
 * **Never claim compliance. Report against a ruleset version.**
 *
 * The wording below is the §1.5 text with its placeholders filled. Where a
 * placeholder has no value yet — the spec version is still the
 * `RESOLVE_IN_WEEK_1` sentinel — the disclaimer says so rather than rendering
 * an empty gap, because a disclaimer that reads as if it names a version it
 * does not name is worse than one that admits the version is unresolved.
 */
export function ScopeDisclaimer(props: {
  specName: string | null;
  version: string | null;
  rulesetHash: string | null;
  publishedOn?: string | null;
}) {
  const specName = props.specName ?? 'an unresolved specification';
  const version = props.version ?? 'unresolved';
  const rulesetHash = props.rulesetHash ?? 'unresolved';
  const publishedOn = props.publishedOn ?? 'an unrecorded date';

  return (
    <footer className="mt-12 border-t pt-4 text-xs leading-relaxed opacity-75">
      <p>
        This report assesses conformance against <em>{specName} version {version}</em>,
        {' '}ruleset <code className="mono">{rulesetHash}</code>, as published on{' '}
        <em>{publishedOn}</em>. It is a technical data-quality assessment and does not
        constitute tax advice, a tax position, or a statement of compliance. Tax
        interpretation remains with the client&apos;s appointed tax advisor.
      </p>
    </footer>
  );
}
