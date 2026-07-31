import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">Compliance Data Layer</h1>
      <p className="mt-2 text-sm opacity-80">
        Audit Engine — internal. architecture.md Part III §1.
      </p>
      <ul className="mt-6 space-y-2">
        <li>
          <Link className="underline" href="/audits/new">
            Start an audit
          </Link>
        </li>
      </ul>
    </main>
  );
}
