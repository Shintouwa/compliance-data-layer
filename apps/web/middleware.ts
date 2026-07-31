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
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    // Everything except Next internals and static files.
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
