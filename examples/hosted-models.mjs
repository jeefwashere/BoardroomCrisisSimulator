/** Server-side Node module. Never import into a frontend bundle. */
export async function runLocalModel(prompt, model = 'lfm3', { timeout = 120000 } = {}) {
  const base = process.env.REHEARSAL_API_URL;
  if (!base?.startsWith('https://')) throw new Error('REHEARSAL_API_URL must use HTTPS');
  if (!process.env.REHEARSAL_APP_KEY || !process.env.REHEARSAL_SITE_TOKEN) throw new Error('Missing server model credentials');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.REHEARSAL_APP_KEY}`,
    'OAI-Sites-Authorization': `Bearer ${process.env.REHEARSAL_SITE_TOKEN}`,
  };
  const id = crypto.randomUUID();
  async function request(path, payload) {
    const r = await fetch(base + path, { headers, method: payload ? 'POST' : 'GET',
      body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(30000) });
    const b = await r.json();
    if (!r.ok) throw new Error(b.error || `Model API error ${r.status}`);
    return b;
  }
  await request('/api/jobs', { request_id: id, model, prompt });
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const { jobs } = await request(`/api/jobs?id=${id}`);
    if (jobs[0]?.status === 'done') return JSON.parse(jobs[0].result);
    if (jobs[0]?.status === 'failed') throw new Error(jobs[0].error);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error(`Request remains pending; retrieve job ${id}`);
}
