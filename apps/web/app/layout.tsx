import type { Metadata } from 'next';
import { ClerkProvider, Show, SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Compliance Data Layer',
  description: 'CTC readiness, remediation and validation.',
};

/**
 * architecture.md Part III: Server Components by default; `'use client'` only
 * for interactive leaves.
 *
 * Clerk provides auth (§1.2, free tier, orgs → `app.tenant`). It reads its
 * publishable key from the environment at render; without one the app refuses
 * to render rather than serving an unauthenticated page.
 *
 * `<Show when="signed-in">` is the current control component in `@clerk/nextjs`
 * v7 — an async Server Component whose `when` also accepts `{ role }`,
 * `{ permission }` and predicate forms. `<SignedIn>` / `<SignedOut>` are gone
 * from the package's export list; do not reintroduce them.
 *
 * **This header is chrome, not a control.** What it shows follows the session,
 * but nothing is protected by hiding a link — `requireTenantActor()` gates
 * every route and Server Action that touches client data, and RLS gates the
 * database underneath that. A rendered header is not a permission.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10">
            <Link href="/" className="text-sm font-semibold">
              Compliance Data Layer
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button type="button" className="underline underline-offset-4">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button type="button" className="underline underline-offset-4">
                    Sign up
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </nav>
          </header>
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
