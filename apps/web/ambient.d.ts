/// <reference types="next" />
/// <reference types="next/image-types/global" />

// Next.js generates `next-env.d.ts` with these same two references, plus a
// third — `./.next/types/routes.d.ts` — that only exists after a build. That
// file is gitignored, so a committed `next-env.d.ts` makes the ROOT
// `pnpm tsc --noEmit` fail on a fresh clone with "cannot find
// ./.next/types/routes.d.ts", which is the first line of `make check`.
//
// So `next-env.d.ts` is gitignored and this hand-written equivalent is
// committed instead: stable, no build artefact required, and it cannot be
// rewritten by `next dev` into something that breaks the check.
//
// NOT named `next.d.ts`: `baseUrl: "."` in apps/web/tsconfig.json makes every
// top-level file a module candidate, so `next.d.ts` shadows the `next` package
// and `import type { Metadata } from 'next'` resolves here instead —
// "File '.../next.d.ts' is not a module".
