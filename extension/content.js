// Reach content script v0.3.0 — clean break from the leaky-counter era.
// In v0.3.0 the local counter is gone — overlay numbers come ONLY from /api/extension/stats.
// Backend uses merge-not-overwrite, so re-indexing never destroys good data.

(function () {
  if (window.__reachInjected) return;
  window.__reachInjected = true;
  console.log('[Reach 0.3] content script loaded on', location.href);

  // ============================================================
  // UTILITIES
  // ============================================================
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b));

  // True if the extension context is still attached. After a reload/update,
  // chrome.runtime?.id becomes undefined and any sendMessage call will throw.
  function runtimeAlive() {
    try { return !!(chrome?.runtime?.id); } catch (_) { return false; }
  }

  // Safe sendMessage wrapper: never throws, never spams "context invalidated".
  function safeSendMessage(payload) {
    return new Promise(resolve => {
      if (!runtimeAlive()) { resolve(null); return; }
      try {
        chrome.runtime.sendMessage(payload, response => {
          // Touch lastError so Chrome doesn't log "Unchecked runtime.lastError"
          const _ = chrome.runtime?.lastError;
          resolve(response ?? null);
        });
      } catch (_) {
        // Context was invalidated between the check and the call — silently bail
        resolve(null);
      }
    });
  }

  function sendIngest(kind, payload) {
    return safeSendMessage({
      type: 'reach:ingest', kind, payload: { ...payload, source_url: location.href },
    }).then(response => {
      // Trigger a DB-stats refresh so overlay shows true counts
      safeSendMessage({ type: 'reach:fetch_db_stats' });
      return response || { ok: false };
    });
  }

  // === PAGE ANALYSIS (debug) ===
  // Captures a cleaned snapshot of the page's HTML and uploads it to the backend
  // (kind 'debug', mode 'analyze') so the structure can be inspected from the DB
  // when fixing scraper selectors. Scripts/styles/SVGs and bulky attributes are
  // stripped to keep it small and readable; text/aria-label/alt are preserved.
  function captureCleanedHTML() {
    const root = document.querySelector('main') || document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll('script,style,svg,noscript,iframe,link,template,picture source').forEach(n => n.remove());
    clone.querySelectorAll('*').forEach(el => {
      el.removeAttribute('style');
      // Drop heavy/base64 attributes but keep semantic ones (href, aria-*, alt, role, class)
      for (const attr of ['src', 'srcset', 'data-delayed-url', 'data-ghost-url']) el.removeAttribute(attr);
      for (const a of [...el.attributes]) {
        if (a.value && a.value.length > 300) el.removeAttribute(a.name);
      }
    });
    let html = (clone.outerHTML || '').replace(/\s+/g, ' ').replace(/>\s+</g, '><');
    return html.slice(0, 400000); // cap ~400KB
  }

  async function analyzePage() {
    const html = captureCleanedHTML();
    const res = await sendIngest('debug', {
      mode: 'analyze',
      path: location.pathname,
      url: location.href,
      title: document.title,
      length: html.length,
      thread_links: document.querySelectorAll('a[href*="/messaging/thread/"]').length,
      profile_links: document.querySelectorAll('a[href*="/in/"]').length,
      html,
    });
    return { ok: !!res?.ok, length: html.length };
  }

  // === LINKEDIN VOYAGER API PROBE (debug) ===
  // Calls LinkedIn's internal JSON API the same way the page does (same-origin,
  // session cookies + csrf-token header) and dumps the results to the debug sink,
  // so we can switch message capture from fragile DOM scraping to a structured API.
  // Also reports the real endpoints the page already hit (via performance timings),
  // which reveals the exact current URLs / GraphQL query IDs.
  async function probeLinkedInApi() {
    const out = { mode: 'voyager-probe', url: location.href, csrf_present: false, discovered: [], results: [] };

    // CSRF token == the JSESSIONID cookie value (e.g. "ajax:1234567890").
    let csrf = '';
    try {
      const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
      csrf = m ? m[1] : '';
      out.csrf_present = !!csrf;
    } catch (_) {}

    // Discover the messaging endpoints the page already requested.
    try {
      const entries = performance.getEntriesByType('resource') || [];
      const urls = entries.map(e => e.name).filter(u => /voyager\/api|messaging|messenger|msg/i.test(u));
      out.discovered = [...new Set(urls)].slice(0, 50);
    } catch (_) {}

    const headers = {
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'csrf-token': csrf,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
    };
    // Candidate endpoints (LinkedIn shifts these; we try a few + anything discovered).
    const candidates = [
      '/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX',
      '/voyager/api/messaging/conversations',
      ...out.discovered.filter(u => /conversation/i.test(u)).slice(0, 3),
    ];
    for (const path of [...new Set(candidates)]) {
      try {
        const res = await fetch(path, { headers, credentials: 'include' });
        const text = await res.text();
        // Keep the full body for the messaging GraphQL endpoints so we can design
        // the parser; truncate everything else.
        const cap = /messengerConversations|messengerMessages/i.test(path) ? 380000 : 2000;
        out.results.push({ path, status: res.status, ok: res.ok, len: text.length, bodySample: text.slice(0, cap) });
      } catch (e) {
        out.results.push({ path, error: String(e) });
      }
    }
    await sendIngest('debug', out);
    return { ok: true, tried: out.results.length, discovered: out.discovered.length, csrf: out.csrf_present };
  }

  // === RELIABLE MESSAGE CAPTURE VIA LINKEDIN'S VOYAGER API ===
  // Instead of scraping the DOM, call the same GraphQL endpoint the page uses and
  // parse LinkedIn's normalized JSON. Returns structured conversations with real
  // participant URNs, message bodies, and timestamps. Endpoint + mailbox URN are
  // discovered from the page's own network calls (performance timings), so this
  // survives LinkedIn redesigns far better than CSS selectors.
  function parseConversationsResponse(data) {
    const inc = (data && data.included) || [];
    const nameOf = p => {
      const mem = p.participantType && p.participantType.member;
      if (mem) return [mem.firstName && mem.firstName.text, mem.lastName && mem.lastName.text].filter(Boolean).join(' ').trim();
      const org = p.participantType && p.participantType.organization;
      if (org && org.name && org.name.text) return org.name.text.trim();
      return null;
    };
    const partByRef = {};
    for (const x of inc) {
      if (x.$type === 'com.linkedin.messenger.MessagingParticipant') {
        const mem = x.participantType && x.participantType.member;
        partByRef[x.entityUrn] = {
          urn: x.hostIdentityUrn || null,
          name: nameOf(x),
          profileUrl: mem && mem.profileUrl ? mem.profileUrl : (x.hostIdentityUrn ? `https://www.linkedin.com/in/${x.hostIdentityUrn.split(':').pop()}/` : null),
        };
      }
    }
    const msgsByConv = {};
    for (const x of inc) {
      if (x.$type === 'com.linkedin.messenger.Message') {
        const c = x['*conversation'];
        if (!c) continue;
        (msgsByConv[c] = msgsByConv[c] || []).push(x);
      }
    }
    // Self = the fsd_profile embedded in every conversation URN.
    let selfFsd = null;
    const anyConv = inc.find(x => x.$type === 'com.linkedin.messenger.Conversation');
    if (anyConv) { const m = (anyConv.entityUrn || '').match(/fsd_profile:([^,)]+)/); selfFsd = m ? m[1] : null; }

    const threads = [];
    const peopleMap = {};
    for (const x of inc) {
      if (x.$type !== 'com.linkedin.messenger.Conversation') continue;
      const convUrn = x.entityUrn;
      const tid = ((x.conversationUrl || '').match(/thread\/([^/?#]+)/) || [])[1] || convUrn;
      const refs = x['*conversationParticipants'] || [];
      const others = refs.filter(r => !selfFsd || !r.includes(selfFsd));
      const names = [], urns = [];
      for (const r of others) {
        const p = partByRef[r];
        if (!p) continue;
        if (p.name) names.push(p.name);
        if (p.urn) {
          urns.push(p.urn);
          if (!peopleMap[p.urn]) peopleMap[p.urn] = { urn: p.urn, public_id: p.urn.split(':').pop(), name: p.name || null, headline: null, profile_url: p.profileUrl, profile_img: null };
        }
      }
      const msgs = (msgsByConv[convUrn] || [])
        .slice()
        .sort((a, b) => (a.deliveredAt || 0) - (b.deliveredAt || 0))
        .map(mm => {
          const senderRef = mm['*sender'] || mm['*actor'];
          const isSelf = senderRef && selfFsd && senderRef.includes(selfFsd);
          const sp = senderRef ? partByRef[senderRef] : null;
          return {
            content: (mm.body && mm.body.text) || '',
            direction: isSelf ? 'outbound' : 'inbound',
            sender: isSelf ? null : (sp ? sp.name : null),
            sender_urn: isSelf ? null : (sp ? sp.urn : null),
            sent_at: mm.deliveredAt ? new Date(mm.deliveredAt).toISOString() : null,
          };
        })
        .filter(m => m.content);
      threads.push({
        external_id: tid,
        title: names.join(', ') || x.title || 'Conversation',
        participants: names,
        participant_urns: urns,
        messages: msgs,
      });
    }
    return { threads, people: Object.values(peopleMap) };
  }

  async function captureViaApi(updateUi) {
    const ui = updateUi || (() => {});
    const m = document.cookie.match(/JSESSIONID="?([^";]+)"?/);
    const csrf = m ? m[1] : '';
    if (!csrf) return { ok: false, error: 'no-csrf' };

    // Discover the conversations endpoint (queryId + mailboxUrn) the page already used.
    let convUrl = null;
    try {
      const entries = performance.getEntriesByType('resource') || [];
      convUrl = entries.map(e => e.name).find(u => /voyagerMessagingGraphQL\/graphql\?queryId=messengerConversations/.test(u));
    } catch (_) {}
    if (!convUrl) return { ok: false, error: 'endpoint-not-found' };

    ui('Fetching conversations from LinkedIn API…');
    const headers = {
      'accept': 'application/vnd.linkedin.normalized+json+2.1',
      'csrf-token': csrf,
      'x-restli-protocol-version': '2.0.0',
      'x-li-lang': 'en_US',
    };
    let data;
    try {
      const res = await fetch(convUrl, { headers, credentials: 'include' });
      if (!res.ok) return { ok: false, error: 'http-' + res.status };
      data = await res.json();
    } catch (e) { return { ok: false, error: String(e) }; }

    const { threads, people } = parseConversationsResponse(data);
    try {
      await sendIngest('debug', { mode: 'api-capture', threads_found: threads.length, people_found: people.length, sample: threads.slice(0, 3).map(t => ({ t: t.title, m: t.messages.length })) });
    } catch (_) {}
    if (people.length) await sendIngest('people', { people });
    if (threads.length) await sendIngest('messages', { threads });
    ui(`Captured ${threads.length} conversations via API.`);
    return { ok: true, threads: threads.length, people: people.length };
  }

  // Listen for explicit debug requests from the popup.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === 'reach:analyze_page') {
        analyzePage().then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
        return true; // async response
      }
      if (msg?.type === 'reach:probe_api') {
        probeLinkedInApi().then(sendResponse).catch(e => sendResponse({ ok: false, error: String(e) }));
        return true; // async response
      }
    });
  } catch (_) {}

  async function getIndexedMap() {
    const m = await safeSendMessage({ type: 'reach:get_indexed_at' });
    return m || {};
  }
  function markIndexed(path) {
    safeSendMessage({ type: 'reach:set_indexed_at', path, at: new Date().toISOString() });
  }
  async function getStats() {
    const s = await safeSendMessage({ type: 'reach:stats' });
    return s || {};
  }

  // ============================================================
  // EMBEDDED JSON EXTRACTION (enhanced)
  // ============================================================
  function getEmbeddedJson() {
    const blobs = [];
    document.querySelectorAll('code[id^="bpr-guid"], code[style*="display:none"], code[id*="datalet"]').forEach(el => {
      try {
        const text = el.textContent;
        if (!text || !text.trim().startsWith('{')) return;
        blobs.push(JSON.parse(text));
      } catch (_) {}
    });
    return blobs;
  }

  function findEntities(blobs, predicate) {
    const found = [];
    const visited = new WeakSet();
    function walk(node) {
      if (!node || typeof node !== 'object') return;
      if (visited.has(node)) return;
      visited.add(node);
      if (Array.isArray(node)) { for (const i of node) walk(i); return; }
      if (predicate(node)) found.push(node);
      for (const k of Object.keys(node)) walk(node[k]);
    }
    for (const b of blobs) walk(b);
    return found;
  }

  function extractPersonFromEntity(e) {
    if (!e) return null;
    // Handle multiple LinkedIn entity shapes
    const urn =
      e.entityUrn ||
      e.objectUrn ||
      (e.publicIdentifier ? `urn:li:fsd_profile:${e.publicIdentifier}` : null);
    if (!urn || typeof urn !== 'string' || (!urn.includes('profile') && !urn.includes('member'))) return null;
    const firstName = typeof e.firstName === 'string' ? e.firstName : e.firstName?.text || '';
    const lastName = typeof e.lastName === 'string' ? e.lastName : e.lastName?.text || '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || e.title?.text || e.name || null;
    const headline = e.headline?.text || (typeof e.headline === 'string' ? e.headline : null) || e.occupation || null;
    const profile_url = e.publicIdentifier ? `https://www.linkedin.com/in/${e.publicIdentifier}/` : null;
    const profile_img =
      e.picture?.['com.linkedin.common.VectorImage']?.rootUrl ||
      e.profilePicture?.displayImageReference?.vectorImage?.rootUrl ||
      e.profilePictureOriginalImage?.rootUrl ||
      null;
    return { urn, public_id: e.publicIdentifier || null, name, headline, profile_url, profile_img };
  }

  function extractAllPeopleFromJson() {
    const blobs = getEmbeddedJson();
    const seen = new Set();
    const people = [];
    // Cast a wide net: anything with firstName + lastName + (publicIdentifier or entityUrn)
    const predicate = e => (e?.firstName || e?.miniProfile?.firstName) && (e?.publicIdentifier || e?.miniProfile?.publicIdentifier || e?.entityUrn);
    for (const e of findEntities(blobs, predicate)) {
      const target = e.miniProfile || e;
      const p = extractPersonFromEntity(target);
      if (p && p.urn && !seen.has(p.urn)) {
        seen.add(p.urn);
        people.push(p);
      }
    }
    return people;
  }

  // ============================================================
  // PAGE HANDLERS (preserved + enhanced)
  // ============================================================
  function extractProfilePageDOM() {
    try {
      const match = location.pathname.match(/\/in\/([^/]+)/);
      const publicId = match?.[1];
      if (!publicId) return null;

      // Find the profile header — typically contains H1 with the name
      // Try several heuristics in order of confidence.
      let name = null;
      const h1 = document.querySelector('main h1') || document.querySelector('h1');
      if (h1) {
        const t = h1.textContent?.trim();
        if (t && t.length >= 2 && t.length < 100) name = t;
      }

      // Headline — usually the text directly under the H1
      let headline = null;
      if (h1) {
        // Walk forward through siblings of h1's parent looking for headline-like text
        const headerBlock = h1.closest('section, div, article') || h1.parentElement;
        if (headerBlock) {
          const texts = [];
          const walker = document.createTreeWalker(headerBlock, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const t = (walker.currentNode.textContent || '').trim();
            if (t.length >= 5 && t.length < 250 && t !== name) texts.push(t);
          }
          // First non-name text long enough to be a headline (not a location, not a count)
          const NOISE = /^(Open to|Add profile section|More|Connect|Message|Follow|\d+\s*(connections?|followers?|mutual))/i;
          const LOC = /^[A-Z][a-zA-Z]+(?:,\s*[A-Z][a-zA-Z\s]+){1,2}$/; // "Sharjah, Sharjah Emirate"
          for (const t of texts) {
            if (NOISE.test(t)) continue;
            if (LOC.test(t) && t.length < 60) continue;
            if (/^\d/.test(t)) continue;
            headline = t;
            break;
          }
        }
      }

      // Location — try to find a short comma-separated string
      let location_ = null;
      const headerBlock = h1?.closest('section, div, article') || h1?.parentElement;
      if (headerBlock) {
        const texts = [];
        const walker = document.createTreeWalker(headerBlock, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const t = (walker.currentNode.textContent || '').trim();
          if (t.length >= 3 && t.length < 80) texts.push(t);
        }
        const LOC = /^[A-Z][a-zA-Z]+(?:[\s,]+[A-Z][a-zA-Z\s]+){1,3}$/;
        for (const t of texts) {
          if (t === name || t === headline) continue;
          if (LOC.test(t)) { location_ = t; break; }
        }
      }

      // Photo
      const imgEl = document.querySelector('main img[src*="profile-displayphoto"], main img[width][height]');

      return {
        urn: `urn:li:fsd_profile:${decodeURIComponent(publicId)}`,
        public_id: decodeURIComponent(publicId),
        name,
        headline,
        location: location_,
        profile_url: `https://www.linkedin.com/in/${publicId}/`,
        profile_img: imgEl?.src || null,
      };
    } catch (e) {
      console.error('[Reach 0.3] profile DOM extract failed', e);
      return null;
    }
  }

  async function handleProfilePage() {
    const me = extractProfilePageDOM();
    if (!me) return;
    // Derive company + position from headline using LinkedIn's common patterns
    if (me.headline) {
      const atMatch = me.headline.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[,|·]|$)/i);
      if (atMatch) {
        me.position = atMatch[1].trim();
        me.company = atMatch[2].trim();
      } else {
        const sepMatch = me.headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
        if (sepMatch) {
          me.position = sepMatch[1].trim();
          const right = sepMatch[2].trim();
          const looksLikeRole = /\b(engineer|developer|designer|manager|analyst|consultant|specialist|coordinator|director|founder|coach|trainer|expert|architect|strategist)\b/i.test(right);
          const hasStopwords = /\s(and|or|with|for|of|the)\s/i.test(right);
          if (right.length < 50 && right.length >= 3 && !hasStopwords && !looksLikeRole) {
            me.company = right.split(/[|·]/)[0].trim();
          }
        }
      }
    }
    await sendIngest('people', { people: [me] });

    const isSelf =
      !!document.querySelector('[aria-label*="Edit intro" i]') ||
      !!document.querySelector('a[href*="/edit/intro/"]') ||
      !!document.querySelector('button[aria-label*="Edit your profile" i]') ||
      !!document.querySelector('[aria-label*="Add profile section" i]') ||
      !!document.querySelector('a[href="/in/me/"]') ||
      /\/in\/me\//.test(location.pathname);
    if (isSelf) {
      console.log('[Reach 0.3] Detected self profile:', me.urn);
      await sendIngest('self', {
        urn: me.urn, name: me.name, public_id: me.public_id,
        headline: me.headline, profile_url: me.profile_url, profile_img: me.profile_img,
      });
      chrome.storage.local.set({ reachSelfUrn: me.urn });
    }

    // Also extract any activity posts visible on this profile (their recent posts/reactions)
    const posts = [];
    document.querySelectorAll('[data-urn^="urn:li:activity:"]').forEach(el => {
      const urn = el.getAttribute('data-urn');
      if (!urn) return;
      const contentEl = el.querySelector('.feed-shared-update-v2__description-wrapper, [class*="update-components-text"]');
      const content = contentEl?.textContent?.trim()?.slice(0, 4000) || null;
      // Author URN for profile activity = the profile owner
      posts.push({ urn, content, author_urn: me.urn });
    });
    if (posts.length > 0) await sendIngest('posts', { posts });
  }

  async function handleConnectionsPage() {
    // LinkedIn redesigned the connections page with hashed class names and
    // a structure where the profile link wraps only the photo, not the name.
    // This extractor walks UP from each profile link to find the card-level
    // container, then reads text nodes inside it to find name + headline.

    const peopleMap = new Map();

    // Wait briefly for cards to render text content
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(800);

      const links = document.querySelectorAll('a[href*="/in/"]');
      links.forEach(link => {
        try {
          const m = link.href.match(/\/in\/([^/?#]+)/);
          if (!m) return;
          const publicId = decodeURIComponent(m[1]);
          if (publicId === 'me' || publicId.length < 2) return;
          const urn = `urn:li:fsd_profile:${publicId}`;
          if (peopleMap.has(urn) && peopleMap.get(urn).name) return;

          // Walk up to find the card boundary.
          // Strategy: keep ascending as long as the parent contains ONLY this profile.
          // Stop the moment the parent would include another /in/ link to a different person.
          let card = link;
          while (card.parentElement && card !== document.body) {
            const parent = card.parentElement;
            const parentLinks = parent.querySelectorAll('a[href*="/in/"]');
            const parentHandles = new Set();
            for (const l of parentLinks) {
              const lm = l.href.match(/\/in\/([^/?#]+)/);
              if (lm) parentHandles.add(lm[1]);
            }
            if (parentHandles.size <= 1) {
              card = parent;
              continue;
            }
            break;
          }
          if (!card || card === document.body) return;
          // Final guard: card must reference exactly this profile
          const finalHandles = new Set();
          for (const l of card.querySelectorAll('a[href*="/in/"]')) {
            const lm = l.href.match(/\/in\/([^/?#]+)/);
            if (lm) finalHandles.add(lm[1]);
          }
          if (finalHandles.size !== 1) return;
          const cardLen = (card.textContent || '').trim().length;
          if (cardLen < 3 || cardLen > 1500) return;

          // Walk all text nodes in the card, collecting non-trivial strings
          const texts = [];
          try {
            const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const t = (walker.currentNode.textContent || '').trim();
              if (t.length >= 2 && t.length < 250) texts.push(t);
            }
          } catch (_) {}

          // Filter out junk: button labels, dates, dots, single chars, section headers
          const NOISE = /^(Message|Connect|Pending|Follow|Following|More|Remove|Open|View|Send|Reply|\.{2,3}|·|—|–|\d+(st|nd|rd|th)?|Sort by|Sort by:|Search.*|Connected on.*|Mutual connections?|See profile|First Name|Last Name|Recently added|Recently connected|All|connections?|Filter)$/i;
          const DATE = /^(Connected on|Joined|Followed|Member since)\b/i;
          const filtered = texts.filter(t =>
            !NOISE.test(t) &&
            !DATE.test(t) &&
            !/^[\s·•\-—–]+$/.test(t) &&
            !/^https?:\/\//.test(t)
          );
          // Dedupe consecutive duplicates
          const uniq = [];
          for (const t of filtered) {
            if (uniq[uniq.length - 1] !== t) uniq.push(t);
          }

          if (uniq.length === 0) return;

          const name = uniq[0];
          // Headline = next non-empty text that isn't just the name repeated
          let headline = null;
          for (let i = 1; i < uniq.length; i++) {
            if (uniq[i] !== name && uniq[i].length >= 2) { headline = uniq[i]; break; }
          }

          if (!name || name.length < 2 || name.length > 100) return;
          // Reject names that look like sentences (likely the headline was first)
          if (/[.!?]\s/.test(name)) return;
          // Reject names that are clearly UI labels — these are the false positives that pollute the network list
          if (/^(connections?|sort by:?|filter|recently added|recently connected|all|invitations|results|see all|view all|more|less|show|hide)$/i.test(name)) return;
          // Reject names that start with a digit (e.g. "101 connections")
          if (/^\d/.test(name)) return;
          // Reject names that contain a colon (e.g. "Sort by:")
          if (/:/.test(name)) return;
          // Reject names that look like section headers (all lowercase or contain stopwords mid-name)
          if (name === name.toLowerCase() && /\s/.test(name)) return;

          // Derive company + position from headline
          let company = null;
          let position = null;
          if (headline) {
            const atMatch = headline.match(/^(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[,|·]|$)/i);
            if (atMatch) {
              position = atMatch[1].trim();
              company = atMatch[2].trim();
            } else {
              const sepMatch = headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
              if (sepMatch) {
                position = sepMatch[1].trim();
                const right = sepMatch[2].trim();
                const looksLikeRole = /\b(engineer|developer|designer|manager|analyst|consultant|specialist|coordinator|director|founder|coach|trainer|expert|architect|strategist)\b/i.test(right);
                const hasStopwords = /\s(and|or|with|for|of|the)\s/i.test(right);
                if (right.length < 50 && right.length >= 3 && !hasStopwords && !looksLikeRole) {
                  company = right.split(/[|·]/)[0].trim();
                }
              }
            }
          }

          const img = card.querySelector('img');
          peopleMap.set(urn, {
            urn,
            public_id: publicId,
            name,
            headline,
            company,
            position,
            profile_url: `https://www.linkedin.com/in/${publicId}/`,
            profile_img: img?.src || null,
            is_first_degree: /\/mynetwork\/(invite-connect\/)?connections/.test(location.pathname),
          });
        } catch (e) {
          /* skip card */
        }
      });

      if (peopleMap.size >= 3) break;
    }

    const people = Array.from(peopleMap.values()).filter(p => p.name && p.name.length >= 2);
    console.log(`[Reach 0.3] Connections handler: extracted ${people.length} people from DOM`);

    if (people.length === 0) return;
    await sendIngest('people', { people });

    const { reachSelfUrn } = await chrome.storage.local.get('reachSelfUrn');
    if (reachSelfUrn) {
      const edges = people.map(p => ({ src_urn: reachSelfUrn, dst_urn: p.urn, edge_type: 'connected' }));
      await sendIngest('edges', { edges });
    }
  }

  async function handleMessagingPage(updateUi, doScroll) {
    // Only run on canonical messaging routes (inbox or a thread view).
    const path = location.pathname;
    const isInbox = /^\/messaging\/?$/.test(path);
    const isThread = /^\/messaging\/thread\/[^/]+\/?$/.test(path);
    if (!isInbox && !isThread) {
      console.log(`[Reach] messaging handler skipped — not a conversation route: ${path}`);
      return { threads: 0, people: 0 };
    }
    const ui = updateUi || (() => {});

    const threadsMap = new Map();
    const peopleMap = new Map();
    let diagReason = {};
    const logReject = r => { diagReason[r] = (diagReason[r] || 0) + 1; };

    const txt = (el, sel) => {
      const n = el.querySelector(sel);
      return n ? (n.textContent || '').replace(/\s+/g, ' ').trim() : '';
    };
    const slug = s => 'name-' + s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

    // Scrape every conversation card currently rendered in the DOM into the maps.
    // LinkedIn virtualizes the list (only ~10-20 cards exist at once and off-screen
    // ones become `--occluded` empty shells), so this is called repeatedly while scrolling.
    function scrapeVisible() {
      document.querySelectorAll('li.msg-conversation-listitem').forEach(card => {
        try {
          if (card.classList.contains('msg-conversation-card--occluded')) return; // virtualized placeholder
          let name =
            txt(card, '.msg-conversation-listitem__participant-names') ||
            txt(card, '.msg-conversation-card__participant-names');
          if (!name) { const im = card.querySelector('img[alt]'); if (im) name = (im.getAttribute('alt') || '').trim(); }
          if (!name) {
            const lbl = card.querySelector('[aria-label^="Select conversation with"]');
            if (lbl) name = (lbl.getAttribute('aria-label') || '').replace(/^Select conversation with\s*/i, '').trim();
          }
          if (!name || name.length < 1 || name.length > 120) { logReject('no-name'); return; }

          let snippet = txt(card, '.msg-conversation-card__message-snippet') || txt(card, '[class*="message-snippet"]');
          let direction = 'inbound', sender = name;
          if (/^you:\s*/i.test(snippet)) { direction = 'outbound'; sender = null; snippet = snippet.replace(/^you:\s*/i, '').trim(); }

          let urn = null, publicId = null, profileUrl = null;
          const inLink = card.querySelector('a[href*="/in/"]');
          if (inLink) {
            const m = (inLink.getAttribute('href') || '').match(/\/in\/([^/?#]+)/);
            if (m) { publicId = decodeURIComponent(m[1]); urn = `urn:li:fsd_profile:${publicId}`; profileUrl = `https://www.linkedin.com/in/${publicId}/`; }
          }

          const externalId = publicId ? `p:${publicId}` : slug(name);
          if (threadsMap.has(externalId)) return;

          const img = card.querySelector('img[src]');
          if (urn && !peopleMap.has(urn)) {
            peopleMap.set(urn, { urn, public_id: publicId, name, headline: null, profile_url: profileUrl, profile_img: img ? img.getAttribute('src') : null });
          }
          threadsMap.set(externalId, {
            external_id: externalId,
            title: name,
            participants: [name],
            participant_urns: urn ? [urn] : [],
            messages: snippet ? [{ content: snippet, direction, sender, sender_urn: direction === 'inbound' ? urn : null, sent_at: null }] : [],
          });
        } catch (_) { logReject('threw'); }
      });
    }

    // Find the scrollable element wrapping the conversation list.
    function findScroller() {
      const ul = document.querySelector('ul.msg-conversations-container__conversations-list');
      let el = ul;
      while (el && el !== document.body) {
        try { if (el.scrollHeight > el.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el; } catch (_) {}
        el = el.parentElement;
      }
      return ul;
    }

    scrapeVisible();

    // Auto-scroll the list to force LinkedIn to render the rest, accumulating as we go.
    if (doScroll) {
      const scroller = findScroller();
      if (scroller) {
        try { scroller.scrollTop = 0; } catch (_) {}
        await sleep(350);
        scrapeVisible();
        let stable = 0;
        for (let i = 0; i < 120 && stable < 4; i++) {
          const before = threadsMap.size;
          scroller.scrollTop = Math.min(scroller.scrollTop + Math.max(scroller.clientHeight * 0.7, 300), scroller.scrollHeight);
          await sleep(rand(450, 850));
          scrapeVisible();
          const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 8;
          ui(`Capturing… ${threadsMap.size} conversations`);
          if (threadsMap.size === before) stable++; else stable = 0;
          if (atBottom && threadsMap.size === before) break;
        }
      }
    }

    const threads = [...threadsMap.values()];
    const people = [...peopleMap.values()];
    console.log(`[Reach] messaging: ${threads.length} conversations, ${people.length} people`);

    try {
      await sendIngest('debug', {
        mode: 'messaging-result',
        path,
        threads_found: threads.length,
        people_found: people.length,
        rejected: diagReason,
        sample_names: threads.slice(0, 5).map(t => t.title),
      });
    } catch (_) {}

    if (people.length > 0) await sendIngest('people', { people });
    if (threads.length > 0) await sendIngest('messages', { threads });
    return { threads: threads.length, people: people.length };
  }

  async function handleFeedPage() {
    const posts = [];
    const seen = new Set();
    // Try multiple selectors — LinkedIn DOM changes often
    const selectors = [
      '[data-urn^="urn:li:activity:"]',
      '[data-id^="urn:li:activity:"]',
      '.feed-shared-update-v2',
      'div[data-test-id*="activity"]',
      'article[data-urn]',
    ];
    let found = 0;
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const urn = el.getAttribute('data-urn') || el.getAttribute('data-id') || '';
        if (!urn || !urn.includes('urn:li:activity:')) return;
        if (seen.has(urn)) return;
        seen.add(urn);
        const contentEl = el.querySelector(
          '.feed-shared-update-v2__description-wrapper, [class*="update-components-text"], [class*="feed-shared-text"], [class*="update__commentary"]'
        );
        const content = contentEl?.textContent?.trim()?.slice(0, 4000) || null;
        const authorLink = el.querySelector('a[href*="/in/"]');
        let author_urn = null;
        if (authorLink) {
          const m = authorLink.href.match(/\/in\/([^/?#]+)/);
          if (m) author_urn = `urn:li:fsd_profile:${m[1]}`;
        }
        posts.push({ urn, content, author_urn });
        found++;
      });
    }
    console.log(`[Reach 0.3] Feed handler: found ${found} posts on ${location.pathname}`);
    if (posts.length > 0) await sendIngest('posts', { posts });
  }

  // ============================================================
  // AUTO-SCROLL CONNECTIONS PAGE (button-triggered)
  // ============================================================
  let autoScrollRunning = false;
  async function autoScrollConnections(updateUi) {
    if (autoScrollRunning) return;
    autoScrollRunning = true;
    const startTime = Date.now();
    const maxDuration = 20 * 60 * 1000; // 20 min cap
    let lastHeight = document.body.scrollHeight;
    let noProgressCount = 0;
    let scrollCount = 0;
    try {
      while (autoScrollRunning) {
        if (Date.now() - startTime > maxDuration) { updateUi('Stopped: time limit'); break; }
        const delta = randInt(400, 800);
        window.scrollBy({ top: delta, behavior: 'smooth' });
        scrollCount++;
        // Pause between scrolls
        const pause = scrollCount % randInt(5, 11) === 0 ? rand(3000, 5000) : rand(1500, 3000);
        await sleep(pause);
        // Run handler to capture newly loaded cards
        await handleConnectionsPage();
        const stats = await getStats();
        updateUi(`Scrolling… ${stats.people || 0} people captured`);
        // Detect end of list
        const newHeight = document.body.scrollHeight;
        if (newHeight === lastHeight) {
          noProgressCount++;
          if (noProgressCount >= 3) { updateUi(`Done. ${stats.people || 0} people captured.`); break; }
        } else {
          noProgressCount = 0;
          lastHeight = newHeight;
        }
      }
      markIndexed(location.pathname);
    } finally {
      autoScrollRunning = false;
    }
  }

  // ============================================================
  // AUTO-WALK INBOX (button-triggered)
  // ============================================================
  let autoWalkRunning = false;
  // SAFE inbox indexing: read ONLY what's already visible on the messaging page.
  // NEVER clicks anything — clicking LinkedIn elements risks withdrawing invitations,
  // sending messages, or other irreversible actions. We just scan the current DOM.
  async function autoWalkInbox(updateUi) {
    if (autoWalkRunning) return;
    autoWalkRunning = true;
    try {
      // Preferred: structured Voyager API (reliable, full data). Falls back to DOM scrape.
      updateUi('Capturing via LinkedIn API…');
      let res = await captureViaApi(updateUi);
      if (!res || !res.ok || (res.threads || 0) === 0) {
        updateUi(`API unavailable (${res && res.error ? res.error : 'no data'}) — scraping the visible list…`);
        res = await handleMessagingPage(updateUi, true); // doScroll = true
      }
      updateUi(`Done. ${res?.threads || 0} conversations captured.`);
      markIndexed(location.pathname);
    } finally {
      autoWalkRunning = false;
    }
  }

  // ============================================================
  // SLIM RIGHT-EDGE SIDEBAR TAB (shadow DOM)
  // ============================================================
  let overlayShadow = null;
  function injectOverlay() {
    if (document.getElementById('reach-overlay-host')) return;
    if (!document.body) return;
    const host = document.createElement('div');
    host.id = 'reach-overlay-host';
    // Pinned to the right edge, vertically centered. Fixed — never draggable.
    host.style.cssText = `position:fixed;z-index:2147483647;top:50%;right:0;transform:translateY(-50%);`;
    const shadow = host.attachShadow({ mode: 'open' });
    overlayShadow = shadow;
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        .wrap { display: flex; align-items: stretch; }
        /* The slim always-visible tab on the very edge */
        .tab {
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          background: #1C1E26; color: #F4EEE3;
          padding: 14px 7px;
          border-radius: 10px 0 0 10px;
          cursor: pointer;
          box-shadow: -2px 0 14px rgba(0,0,0,0.18);
          align-self: center;
          transition: padding 0.15s;
        }
        .tab:hover { padding-left: 9px; }
        .tab-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px currentColor; color: #22c55e; }
        .tab-dot.idle { background: #eab308; color: #eab308; }
        .tab-dot.err { background: #ef4444; color: #ef4444; }
        .tab-dot.unknown { background: #6b7280; color: #6b7280; }
        .tab-label {
          writing-mode: vertical-rl; text-orientation: mixed;
          font-family: 'Fraunces', Georgia, serif; font-style: italic;
          font-size: 14px; font-weight: 500; letter-spacing: 0.02em;
          transform: rotate(180deg);
        }
        /* The panel that slides out */
        .panel {
          background: #1C1E26; color: #F4EEE3;
          border-radius: 12px 0 0 12px; padding: 14px 16px;
          width: 270px; font-size: 12px;
          box-shadow: -6px 0 28px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.05);
          user-select: none;
          /* hidden state: slid off to the right */
          transition: transform 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.18s;
        }
        .wrap:not(.open) .panel {
          transform: translateX(100%); opacity: 0; pointer-events: none;
          position: absolute; right: 0; top: 50%; margin-top: -90px;
        }
        .wrap.open .tab { display: none; }
        .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .lhs { display: flex; align-items: center; gap: 6px; }
        .brand { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-size: 17px; font-weight: 500; }
        .sub { font-size: 9px; text-transform: uppercase; letter-spacing: 0.16em; opacity: 0.5; margin-top: 1px; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px currentColor; color: #22c55e; }
        .dot.idle { background: #eab308; color: #eab308; }
        .dot.err { background: #ef4444; color: #ef4444; }
        .dot.unknown { background: #6b7280; color: #6b7280; }
        .close { background: none; border: none; color: inherit; cursor: pointer; padding: 2px 6px; opacity: 0.5; font-size: 16px; line-height: 1; }
        .close:hover { opacity: 1; }
        .status-line { font-size: 10.5px; opacity: 0.7; margin-top: 2px; }
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; padding: 12px 0; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.08); }
        .stat { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
        .stat-l { opacity: 0.55; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; }
        .stat-v { font-weight: 600; font-size: 14px; }
        .action {
          display: block; width: 100%; margin-top: 6px; padding: 9px 10px;
          background: #F4EEE3; color: #1C1E26; border: none; border-radius: 6px;
          font: inherit; font-weight: 600; font-size: 12px; cursor: pointer; transition: opacity 0.15s;
        }
        .action:hover { opacity: 0.92; }
        .action:disabled { opacity: 0.4; cursor: not-allowed; }
        .progress { margin-top: 6px; font-size: 10.5px; opacity: 0.75; min-height: 1em; line-height: 1.3; }
        .stale-note { font-size: 10px; opacity: 0.6; margin-top: 4px; line-height: 1.3; }
        .openlink { display: block; margin-top: 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; opacity: 0.6; text-decoration: none; color: inherit; }
        .openlink:hover { opacity: 1; }
      </style>
      <div class="wrap" id="wrap">
        <div class="tab" id="tab" title="Open Reach">
          <span class="tab-dot unknown" id="tab-dot"></span>
          <span class="tab-label">Reach</span>
        </div>
        <div class="panel" id="panel">
          <div class="header">
            <div class="lhs">
              <span class="dot unknown" id="dot"></span>
              <div>
                <div class="brand">Reach</div>
                <div class="sub">network indexer</div>
              </div>
            </div>
            <button class="close" id="close" title="Collapse">›</button>
          </div>
          <div class="status-line" id="status-line">Connecting…</div>
          <div class="stats">
            <div class="stat"><span class="stat-l">People</span><span class="stat-v" id="s-p">0</span></div>
            <div class="stat"><span class="stat-l">Edges</span><span class="stat-v" id="s-e">0</span></div>
            <div class="stat"><span class="stat-l">Msgs</span><span class="stat-v" id="s-m">0</span></div>
            <div class="stat"><span class="stat-l">Posts</span><span class="stat-v" id="s-o">0</span></div>
          </div>
          <button class="action" id="action" style="display:none;"></button>
          <div class="stale-note" id="stale"></div>
          <div class="progress" id="prog"></div>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    wireOverlay(host, shadow);
    refreshOverlay();
  }

  function wireOverlay(host, shadow) {
    const wrap = shadow.getElementById('wrap');
    const tab = shadow.getElementById('tab');
    const close = shadow.getElementById('close');

    // Restore open/collapsed state (default: collapsed = just the tab showing)
    chrome.storage.local.get('reachSidebarOpen').then(({ reachSidebarOpen }) => {
      if (reachSidebarOpen) wrap.classList.add('open');
    });

    tab.addEventListener('click', () => {
      wrap.classList.add('open');
      try { chrome.storage.local.set({ reachSidebarOpen: true }); } catch (_) {}
      refreshOverlay();
    });
    close.addEventListener('click', e => {
      e.stopPropagation();
      wrap.classList.remove('open');
      try { chrome.storage.local.set({ reachSidebarOpen: false }); } catch (_) {}
    });
  }

  async function refreshOverlay() {
    if (!overlayShadow) return;
    const stats = await getStats();
    const $ = id => overlayShadow.getElementById(id);
    $('s-p').textContent = (stats.people || 0).toLocaleString();
    $('s-e').textContent = (stats.edges || 0).toLocaleString();
    $('s-m').textContent = (stats.messages || 0).toLocaleString();
    $('s-o').textContent = (stats.posts || 0).toLocaleString();
    // Status dot (both the panel dot and the slim tab dot)
    const dot = $('dot');
    const tabDot = $('tab-dot');
    const statusLine = $('status-line');
    let cls, label;
    if (!stats.last_at) { cls = 'unknown'; label = 'Connected · idle'; }
    else {
      const mins = (Date.now() - new Date(stats.last_at).getTime()) / 60000;
      if (mins < 5) { cls = ''; label = 'Active · indexing'; }
      else if (mins < 60) { cls = 'idle'; label = `Last seen ${Math.round(mins)}m ago`; }
      else { cls = 'unknown'; label = 'Connected · idle'; }
    }
    if (dot) dot.className = 'dot ' + cls;
    if (tabDot) tabDot.className = 'tab-dot ' + cls;
    if (statusLine) statusLine.textContent = label;
    await refreshOverlayAction();
  }

  async function refreshOverlayAction() {
    if (!overlayShadow) return;
    const action = overlayShadow.getElementById('action');
    const stale = overlayShadow.getElementById('stale');
    const prog = overlayShadow.getElementById('prog');
    const path = location.pathname;
    stale.textContent = '';
    prog.textContent = '';

    // Bootstrap check — refuse bulk actions until self is set
    const { reachSelfUrn } = await chrome.storage.local.get('reachSelfUrn');
    const selfNotSet = !reachSelfUrn;

    const indexedMap = await getIndexedMap();
    const lastAt = indexedMap[path] ? new Date(indexedMap[path]) : null;
    const hoursSince = lastAt ? (Date.now() - lastAt.getTime()) / 3600000 : null;

    if (selfNotSet && !/^\/in\//.test(path)) {
      // User hasn't set self yet, and isn't on a profile page — show guide button
      action.style.display = 'block';
      action.className = 'action';
      action.textContent = 'Go to your profile first →';
      action.onclick = () => {
        // Open the "Me" menu — LinkedIn user clicks their own profile from there
        const meButton = document.querySelector('a[href*="/in/"][data-control-name="identity_welcome_message"]')
          || document.querySelector('button.global-nav__me-photo')
          || document.querySelector('img.global-nav__me-photo');
        if (meButton) meButton.click();
        else window.location.href = 'https://www.linkedin.com/in/me/';
      };
      stale.textContent = "Reach needs to know which profile is yours. Visit your own LinkedIn profile once — we'll detect it via the 'Edit intro' button and flag it.";
      return;
    }

    if (/\/mynetwork\/(invite-connect\/)?connections/.test(path)) {
      action.style.display = 'block';
      action.className = 'action';
      action.textContent = autoScrollRunning ? 'Stop' : 'Auto-index this page';
      if (hoursSince !== null && hoursSince < 24 && !autoScrollRunning) {
        stale.textContent = `Indexed ${hoursSince < 1 ? Math.round(hoursSince*60) + 'm' : Math.round(hoursSince) + 'h'} ago — re-index if you'd like.`;
      }
      action.onclick = () => {
        if (autoScrollRunning) {
          autoScrollRunning = false;
          action.textContent = 'Auto-index this page';
          return;
        }
        action.textContent = 'Stop';
        action.classList.add('danger');
        autoScrollConnections(text => {
          prog.textContent = text;
          if (!autoScrollRunning) {
            action.textContent = 'Auto-index this page';
            action.classList.remove('danger');
            refreshOverlay();
          }
        });
      };
    } else if (/^\/messaging\/?$/.test(path) || /^\/messaging\/thread\/[^/]+\/?$/.test(path)) {
      action.style.display = 'block';
      action.className = 'action';
      action.textContent = 'Capture visible conversations';
      stale.textContent = 'Reads only what\u2019s on screen \u2014 never clicks anything. Scroll to load more, then tap again.';
      action.onclick = () => {
        action.textContent = 'Reading\u2026';
        autoWalkInbox(text => {
          prog.textContent = text;
          action.textContent = 'Capture visible conversations';
          refreshOverlay();
        });
      };
    } else if (/^\/in\//.test(path)) {
      // On a profile page — show a hint instead of an action
      action.style.display = 'none';
      const isSelf =
        !!document.querySelector('[aria-label*="Edit intro" i]') ||
        !!document.querySelector('a[href*="/edit/intro/"]') ||
        !!document.querySelector('button[aria-label*="Edit your profile" i]') ||
        !!document.querySelector('[aria-label*="Add profile section" i]') ||
        !!document.querySelector('a[href="/in/me/"]') ||
        /\/in\/me\//.test(path);
      if (isSelf) stale.textContent = "✓ This is your profile — Reach has flagged you as 'self.'";
      else stale.textContent = 'Profile indexed.';
    } else {
      action.style.display = 'none';
    }
  }

  // Receive live stats updates pushed from background
  try {
    chrome.runtime.onMessage.addListener(msg => {
      if (msg?.type === 'reach:stats_update') refreshOverlay();
      if (msg?.type === 'reach:self_updated' && msg.urn) {
        try { chrome.storage.local.set({ reachSelfUrn: msg.urn }); } catch (_) {}
      }
    });
  } catch (_) { /* context already invalidated */ }

  // ============================================================
  // ROUTER + 24H DEDUPE (passive scrapes always run, but mark indexed)
  // ============================================================
  async function route() {
    if (!runtimeAlive()) return; // context is dead — go quiet
    const path = location.pathname;
    try {
      if (/^\/in\//.test(path)) await handleProfilePage();
      else if (/^\/mynetwork\/(invite-connect\/)?connections/.test(path)) await handleConnectionsPage();
      else if (/^\/messaging\/?$/.test(path) || /^\/messaging\/thread\/[^/]+\/?$/.test(path)) await handleMessagingPage();
      else if (/^\/feed/.test(path)) await handleFeedPage();
      // Refresh overlay for new path (action button context-dependent)
      refreshOverlayAction();
    } catch (e) {
      // Quietly swallow — context might have been invalidated mid-handler
      if (runtimeAlive()) console.error('[Reach] route handler error', e);
    }
  }

  // Bootstrap
  function bootstrap() {
    injectOverlay();
    setTimeout(route, 1500);
    // Pull real DB counts immediately so the overlay isn't stale
    safeSendMessage({ type: 'reach:fetch_db_stats' });
  }
  if (document.body) bootstrap();
  else document.addEventListener('DOMContentLoaded', bootstrap, { once: true });

  // SPA navigation watcher — also gates on runtimeAlive
  let lastPath = location.pathname;
  setInterval(() => {
    if (!runtimeAlive()) return;
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(route, 1500);
    }
  }, 1200);

  // Periodic passive re-scan (in case content lazy-loads). Gated on runtimeAlive.
  setInterval(() => { if (runtimeAlive()) route(); }, 120000);

  // Refresh overlay every 20s in case background ping ran. Gated on runtimeAlive.
  setInterval(() => { if (runtimeAlive()) refreshOverlay(); }, 20000);
})();
