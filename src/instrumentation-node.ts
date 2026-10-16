/**
 * Node.js-only half of the instrumentation hook — imported EXCLUSIVELY from
 * instrumentation.ts inside the `NEXT_RUNTIME === 'nodejs'` branch, so the
 * Edge bundle never sees node:fs / node:path.
 */
import fs from 'node:fs';
import path from 'node:path';

const TARGET = 'src/lib/d1-secrets.ts';
const EXAMPLE = 'src/lib/d1-secrets.example.ts';

function heal(): void {
  try {
    const root = process.cwd();
    const target = path.join(root, TARGET);
    const example = path.join(root, EXAMPLE);
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
}

export function registerNodeHeal(): void {
  heal();
  const timer = setInterval(heal, 15_000);
  if (typeof timer.unref === 'function') timer.unref();
}
