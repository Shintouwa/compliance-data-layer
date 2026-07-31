import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
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
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
