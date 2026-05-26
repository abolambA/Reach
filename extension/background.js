// Reach background service worker v0.3.0
// SINGLE SOURCE OF TRUTH for counters: /api/extension/stats (real DB counts).
// Local reachStats is a CACHE only — never incremented by ingest results.
// This eliminates the inflated-counter-then-reset bug from v0.2.x.

const DEFAULT_API = 'http://localhost:3000';
const PING_ALARM = 'reach-ping';
const PING_PERIOD_MIN = 5;

async function getConfig() {
  const { reachApi, reachToken } = await chrome.storage.local.get(['reachApi', 'reachToken']);
  return {
    api: (reachApi || DEFAULT_API).replace(/\/$/, ''),
    token: reachToken || '',
  };
}

async function broadcastStats() {
  const { reachStats } = await chrome.storage.local.get('reachStats');
  const tabs = await chrome.tabs.query({ url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'] });
  for (const t of tabs) {
    try {
      await chrome.tabs.sendMessage(t.id, { type: 'reach:stats_update', stats: reachStats || {} });
    } catch (_) { /* content script not ready */ }
  }
}

async function fetchDbStats() {
  const { api, token } = await getConfig();
  if (!token) return null;
  try {
    const res = await fetch(`${api}/api/extension/stats`, {
      headers: { 'Authorization': `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    const prev = (await chrome.storage.local.get('reachStats')).reachStats || {};
    const stats = {
      people: data.people,
      edges: data.edges,
      messages: data.messages,
      posts: data.posts,
      has_self: data.has_self,
      last_at: prev.last_at || null, // preserve last-ingest timestamp
    };
    await chrome.storage.local.set({ reachStats: stats });
    broadcastStats();
    return stats;
  } catch (e) {
    console.error('[Reach] fetchDbStats error', e);
    return null;
  }
}

async function postIngest(kind, payload) {
  const { api, token } = await getConfig();
  if (!token) {
    console.warn('[Reach] No token configured; skipping send.');
    return { ok: false, error: 'no_token' };
  }
  const url = `${api}/api/extension/${kind}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[Reach] ${kind} ingest failed`, res.status, data);
      return { ok: false, status: res.status, error: data.error };
    }
    // CRITICAL: do NOT increment local counters here. Just update the timestamp.
    const prev = (await chrome.storage.local.get('reachStats')).reachStats || {};
    await chrome.storage.local.set({
      reachStats: { ...prev, last_at: new Date().toISOString() },
    });
    // Re-fetch real counts from DB (the only source of truth)
    fetchDbStats(); // fire and forget — broadcast happens inside
    return { ok: true, data };
  } catch (e) {
    console.error('[Reach] Network error', e);
    return { ok: false, error: String(e) };
  }
}

async function ping() {
  const { api, token } = await getConfig();
  if (!token) return { ok: false, error: 'no_token' };
  try {
    const res = await fetch(`${api}/api/extension/ping`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// Periodic ping — keeps the "Active" badge fresh AND refreshes counts
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PING_ALARM, { periodInMinutes: PING_PERIOD_MIN });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PING_ALARM, { periodInMinutes: PING_PERIOD_MIN });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== PING_ALARM) return;
  const linkedinTabs = await chrome.tabs.query({
    url: ['https://www.linkedin.com/*', 'https://linkedin.com/*'],
  });
  if (linkedinTabs.length === 0) return;
  await ping();
  await fetchDbStats();
});

// Message router
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'reach:ingest') {
    postIngest(msg.kind, msg.payload).then(sendResponse);
    return true;
  }
  if (msg?.type === 'reach:ping') {
    ping().then(sendResponse);
    return true;
  }
  if (msg?.type === 'reach:stats') {
    chrome.storage.local.get('reachStats').then(({ reachStats }) => sendResponse(reachStats || {}));
    return true;
  }
  if (msg?.type === 'reach:fetch_db_stats') {
    fetchDbStats().then(stats => sendResponse({ ok: !!stats, data: stats }));
    return true;
  }
  if (msg?.type === 'reach:get_indexed_at') {
    chrome.storage.local.get('reachIndexedAt').then(({ reachIndexedAt }) => {
      sendResponse(reachIndexedAt || {});
    });
    return true;
  }
  if (msg?.type === 'reach:set_indexed_at') {
    chrome.storage.local.get('reachIndexedAt').then(async ({ reachIndexedAt }) => {
      const m = reachIndexedAt || {};
      m[msg.path] = msg.at || new Date().toISOString();
      await chrome.storage.local.set({ reachIndexedAt: m });
      sendResponse({ ok: true });
    });
    return true;
  }
});
