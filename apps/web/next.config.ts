import type { NextConfig } from 'next';

/**
 * architecture.md Part I §1.2 — Next.js 15, App Router only. No Pages Router,
 * no `getServerSideProps`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build artefact, so
  // there is exactly one definition of every schema and contract type and no
  // build step that can go stale. Next has to compile them.
  transpilePackages: ['@repo/db', '@repo/contracts'],
  typescript: {
    // The authoritative typecheck is the root `pnpm tsc --noEmit` (make check,
    // CI step 1), which covers this app plus packages/* in one program. Letting
    // `next build` run its own narrower check as well only adds a second,
    // weaker opinion that can disagree with the first.
    ignoreBuildErrors: false,
  },
  eslint: {
    // Same reasoning: `pnpm eslint . --max-warnings 0` at the repo root is the
    // gate. `next lint` would run a different config over a subset of files.
    ignoreDuringBuilds: true,
  },
  serverExternalPackages: ['pg', 'pg-boss', 'exceljs'],
};

export default nextConfig;
