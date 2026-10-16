/**
 * Next.js instrumentation — runs when the SERVER process boots.
 *
 * SELF-HEAL for a missing src/lib/d1-secrets.ts:
 * that file is GIT-IGNORED (the D1 token must never enter git), so a fresh
 * clone or a cleaned workspace loses it — and because d1-config.ts imports it
 * statically, the whole page bundle fails with
 * "Module not found: Can't resolve './d1-secrets'" (preview 500 / build fail).
 *
 * The Node.js half lives in instrumentation-node.ts and is imported ONLY
 * inside the NEXT_RUNTIME === 'nodejs' branch — the documented pattern that
 * keeps node:fs/node:path out of the Edge bundle. It checks the file at boot
 * and every 15 seconds; when missing it is recreated from the committed
 * template (PASTE_YOUR_ placeholders → the app builds and runs 100% offline,
 * cloud sync simply stays dormant). An existing file is NEVER overwritten.
 *
 * In production APK/web builds the file always exists, so this is a no-op
 * there; the interval is unref'd so it can never keep a process alive.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { registerNodeHeal } = await import('./instrumentation-node');
    registerNodeHeal();
  }
}
