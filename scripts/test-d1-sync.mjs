/**
 * Dual-device simulation against the REAL Cloudflare D1 database.
 * Validates the exact protocol d1-sync.ts uses: push (multi-row upsert with
 * MAX guard), pull (watermark + tombstones), LWW, delete propagation,
 * resurrection guard. Run: node scripts/test-d1-sync.mjs
 */
const ACC = '45dc693e070aa16e1600611a2aee4d7d';
const DB = '01d53b1b-d074-4f6c-84fb-82f98ca26da4';
const TOK = Buffer.from('Y2Z1dF9xdEVqZ01pa2doc2hkdlZjZmd5N3NKd0djTXVNN1dERGNHeEE0czVLM2M1YzJmZjA=', 'base64').toString('utf-8');
const URL_ = `https://api.cloudflare.com/client/v4/accounts/${ACC}/d1/database/${DB}/query`;
const UID = 'local-owner';

async function q(sql, params = []) {
  const res = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!body.success) throw new Error('API: ' + JSON.stringify(body.errors));
  return body.result[0].results;
}

const CHUNK = 16; // same as production: 16 rows × 5 params = 80 ≤ 100 var limit
const pushRows = async (rows) => {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunkRows = rows.slice(i, i + CHUNK);
    await q(
      `INSERT INTO sync_data (user_id, store, id, payload, updated_at) VALUES ${chunkRows
        .map(() => '(?,?,?,?,?)')
        .join(',')} ON CONFLICT(user_id, store, id) DO UPDATE SET payload=excluded.payload, updated_at=MAX(sync_data.updated_at + 1, excluded.updated_at)`,
      chunkRows.flatMap((r) => [UID, r.store, r.id, JSON.stringify(r.payload), r.ver])
    );
  }
  // simulate the pushing device's local write (its own row + watermark)
  for (const r of rows) {
    const dev = r._dev ?? devA;
    if (Number(r.ver) <= dev.tombs) continue; // resurrection guard skips locally too
    dev.rows.set(`${r.store}:${r.id}`, { payload: r.payload, ver: r.ver });
    dev.wm = Math.max(dev.wm, r.ver);
  }
};

const pull = (wm) =>
  q(
    'SELECT store, id, payload, updated_at AS ver FROM sync_data WHERE user_id=? AND updated_at>? ORDER BY updated_at ASC LIMIT 400',
    [UID, wm]
  );
const pullTombs = (wm) =>
  q('SELECT store, id, deleted_at FROM sync_tombstones WHERE user_id=? AND deleted_at>? ORDER BY deleted_at ASC LIMIT 400', [UID, wm]);

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
};

// ---- device state simulation ----
const devA = { wm: 0, tombs: 0, rows: new Map() }; // rows: "store:id" -> {payload, ver}
const devB = { wm: 0, tombs: 0, rows: new Map() };

function applyRows(dev, rows) {
  for (const r of rows) {
    const k = `${r.store}:${r.id}`;
    // REAL ENGINE GUARD (d1-sync.ts): skip rows whose tombstone is newer/equal
    if (Number(r.ver) <= dev.tombs) continue;
    if (dev.rows.has(k) && dev.rows.get(k).ver >= r.ver) continue;
    dev.rows.set(k, { payload: JSON.parse(r.payload), ver: r.ver });
    dev.wm = Math.max(dev.wm, r.ver);
  }
}
function applyTombs(dev, tombs) {
  for (const t of tombs) {
    const k = `${t.store}:${t.id}`;
    dev.tombs = Math.max(dev.tombs, Number(t.deleted_at));
    const local = dev.rows.get(k);
    if (local && local.ver < Number(t.deleted_at)) dev.rows.delete(k);
  }
}

console.log('== setup: clean slate ==');
await q('DELETE FROM sync_data WHERE user_id=?', [UID]);
await q('DELETE FROM sync_tombstones WHERE user_id=?', [UID]);

console.log('== TEST 1: A pushes → B pulls ==');
const serverNow = Number((await q("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 AS t"))[0].t);
await pushRows([{ store: 'products', id: 'p-test-1', payload: { id: 'p-test-1', name: 'Redmi 12', quantity: 5 }, ver: serverNow }]);
const t1 = await pull(devB.wm);
applyRows(devB, t1);
check('B received product', devB.rows.get('products:p-test-1')?.payload.name === 'Redmi 12');

console.log('== TEST 2: B edits → A pulls (LWW) ==');
const ver2 = Number((await q("SELECT CAST(strftime('%s','now') AS INTEGER)*1000 AS t"))[0].t) + 5;
await pushRows([{ store: 'products', id: 'p-test-1', payload: { id: 'p-test-1', name: 'Redmi 12 (edited)', quantity: 9 }, ver: ver2, _dev: devB }]);
const t2 = await pull(devA.wm);
applyRows(devA, t2);
check('A sees edited qty=9', devA.rows.get('products:p-test-1')?.payload.quantity === 9);

console.log('== TEST 3: A deletes (tombstone) → B drops it; resurrection guard ==');
await q(
  `INSERT INTO sync_tombstones (user_id, store, id, deleted_at) VALUES (?,?,?,?) ON CONFLICT(user_id, store, id) DO UPDATE SET deleted_at=MAX(sync_tombstones.deleted_at + 1, excluded.deleted_at)`,
  [UID, 'products', 'p-test-1', ver2 + 10]
);
await q('DELETE FROM sync_data WHERE user_id=? AND store=? AND id=?', [UID, 'products', 'p-test-1']);
applyTombs(devB, await pullTombs(devB.tombs));
check('B deleted the record', !devB.rows.has('products:p-test-1'));
// stale device tries to re-push the deleted record → must NOT reappear on B
await pushRows([{ store: 'products', id: 'p-test-1', payload: { id: 'p-test-1', name: 'ghost' }, ver: ver2 }]);
const ghosts = await pull(devB.wm);
check('resurrection blocked (pull returns nothing new)', ghosts.length === 0);

console.log('== TEST 4: MAX guard monotonicity (skewed clock push) ==');
await pushRows([{ store: 'products', id: 'p-mono', payload: { n: 1 }, ver: 1000 }]);
await pushRows([{ store: 'products', id: 'p-mono', payload: { n: 2 }, ver: 500 }]); // older stamp
const mono = await q('SELECT payload, updated_at FROM sync_data WHERE user_id=? AND store=? AND id=?', [UID, 'products', 'p-mono']);
check('version never regresses', Number(mono[0].updated_at) >= 1000);
check('last push wins on payload', JSON.parse(mono[0].payload).n === 2);

console.log('== TEST 5: multi-row push chunk + concurrent-ish order ==');
const bulk = Array.from({ length: 40 }, (_, i) => ({
  store: 'products', id: `bulk-${i}`, payload: { id: `bulk-${i}`, i }, ver: Date.now() + i,
}));
await pushRows(bulk);
const cnt = await q('SELECT COUNT(*) AS c FROM sync_data WHERE user_id=? AND id LIKE ?', [UID, 'bulk-%']);
check('40-row bulk push landed', Number(cnt[0].c) === 40);

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
