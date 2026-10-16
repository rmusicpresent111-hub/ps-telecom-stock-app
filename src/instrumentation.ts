/**
 * Next.js instrumentation — runs inside the SERVER process (nodejs runtime).
 *
 * SELF-HEAL for a missing src/lib/d1-secrets.ts:
 * that file is GIT-IGNORED (the D1 token must never enter git), so a fresh
 * clone or a cleaned workspace loses it — and because d1-config.ts imports it
 * statically, the whole page bundle fails with
 * "Module not found: Can't resolve './d1-secrets'" (preview 500 / build fail).
 *
 * This hook checks for the file once at boot and then every 15 seconds while
 * the server lives; when it is missing it is recreated from the committed
 * template (PASTE_YOUR_ placeholders → the app builds and runs 100% offline,
 * cloud sync simply stays dormant). An existing file is NEVER overwritten.
 *
 * In production APK/web builds the file always exists, so this is a no-op
 * there; the interval is unref'd so it can never keep a process alive.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const fs = await import('node:fs');
  const path = await import('node:path');

  const heal = (): void => {
    try {
      const root = process.cwd();
      const target = path.join(root, 'src', 'lib', 'd1-secrets.ts');
      const example = path.join(root, 'src', 'lib', 'd1-secrets.example.ts');
      if (!fs.existsSync(target) && fs.existsSync(example)) {
        fs.copyFileSync(example, target);
        console.log(
          '[instrumentation] src/lib/d1-secrets.ts was missing — recreated from the template ' +
            '(placeholders → offline mode; cloud sync OFF until real values are pasted).'
        );
      }
    } catch {
      // never crash the server for a convenience file
    }
  };

  heal();
  const timer = setInterval(heal, 15_000);
  if (typeof timer.unref === 'function') timer.unref();
}
