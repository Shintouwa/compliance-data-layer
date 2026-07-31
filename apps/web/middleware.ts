import { clerkMiddleware } from '@clerk/nextjs/server';

/**
 * architecture.md Part I §1.2 — Clerk, `@clerk/nextjs`, orgs → `app.tenant`.
 *
 * The middleware establishes the Clerk session and nothing else. It does NOT
 * decide what is protected.
 *
 * That is deliberate, and it is Clerk's own current guidance: middleware
 * protection matches on PATHS, and path matching can diverge from how Next.js
 * actually routes a request — which leaves a protected resource reachable while
 * the matcher looks correct. For a system whose failure mode is a cross-tenant
 * leak, "looks correct" is not a control.
 *
 * The real gate is `requireTenantActor()` (lib/auth.ts), called by every route
 * and Server Action that touches client data, backed by `app.membership` and
 * then by RLS in the database. Three layers, none of them a path pattern.
 *
 * ---
 *
 * **THE FILENAME IS LOAD-BEARING. It is `middleware.ts` because this app is on
 * Next 15.**
 *
 * Next 16 renames this file to `proxy.ts`. Under Next 15 that name means
 * nothing: `MIDDLEWARE_FILENAME` in `next/dist/lib/constants.js` is the literal
 * string `'middleware'`, and a `proxy.ts` sitting beside it is compiled as an
 * ordinary module and never invoked. `clerkMiddleware()` would then not run on
 * any request, and every `auth()` call downstream would fail at runtime having
 * passed the build — which is the shape of failure §4.1 exists to forbid.
 *
 * When this app moves to Next 16, the migration is `git mv middleware.ts
 * proxy.ts` and nothing else. The contents do not change.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    // Clerk's Frontend API proxy path (`DEFAULT_PROXY_PATH` in
    // @clerk/nextjs/server). The first pattern above already covers it; it is
    // listed explicitly because that pattern is a negative lookahead nobody
    // re-derives when editing, and a handshake that silently stops being
    // matched presents as an intermittent sign-in loop.
    '/__clerk/:path*',
  ],
};
