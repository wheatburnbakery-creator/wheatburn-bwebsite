const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const enabled = Boolean(URL_ && KEY);
const base = enabled ? URL_.replace(/\/$/, '') + '/rest/v1/app_state' : '';
const hdr = () => ({ apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' });
let chain = Promise.resolve();

async function pull() {
  const r = await fetch(base + '?id=eq.1&select=data', { headers: hdr() });
  if (!r.ok) throw new Error('Supabase load failed: ' + r.status);
  const rows = await r.json();
  return rows[0] ? rows[0].data : null;
}

function push(db) {
  const body = JSON.stringify({ data: db, updated_at: new Date().toISOString() });
  chain = chain.then(async () => {
    const r = await fetch(base + '?id=eq.1', {
      method: 'PATCH',
      headers: { ...hdr(), Prefer: 'return=minimal' },
      body,
    });
    if (!r.ok) throw new Error('status ' + r.status);
  }).catch((err) => console.error('[store] Supabase save failed:', err.message));
  return chain;
}

module.exports = { enabled, pull, push };
