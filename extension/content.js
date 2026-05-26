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

  async function handleMessagingPage() {
    // STRICT URL CHECK: only run on canonical messaging routes. Reject:
    //   - /messaging/notifications/ (LinkedIn notification panel disguised as messaging)
    //   - /messaging/compose/ (new message composer)
    //   - any nested route that isn't the inbox or a thread view
    const path = location.pathname;
    const isInbox = /^\/messaging\/?$/.test(path);
    const isThread = /^\/messaging\/thread\/[^/]+\/?$/.test(path);
    if (!isInbox && !isThread) {
      console.log(`[Reach 0.3] Messaging handler skipped — not a conversation route: ${path}`);
      return;
    }

    const threads = [];
    const people = [];
    const seenPeople = new Set();
    const seenThreads = new Set();

    // === CONVERSATION LIST (left rail) ===
    const listContainer =
      document.querySelector('[class*="conversation"], [aria-label*="onversation"]')?.closest('main, section, aside') ||
      document.querySelector('main') ||
      document.body;

    const threadLinks = listContainer.querySelectorAll('a[href*="/messaging/thread/"]');
    let diagSeen = 0, diagReason = {};
    function logReject(reason) {
      diagReason[reason] = (diagReason[reason] || 0) + 1;
    }

    threadLinks.forEach(link => {
      try {
        const tidMatch = link.href.match(/\/messaging\/thread\/([^/?#]+)/);
        if (!tidMatch) { logReject('no-tid'); return; }
        const threadId = tidMatch[1];
        if (seenThreads.has(threadId)) { logReject('dupe'); return; }
        diagSeen++;

        // Walk up to find the card boundary.
        let card = link;
        while (card.parentElement && card !== document.body) {
          const parent = card.parentElement;
          const parentThreadLinks = parent.querySelectorAll('a[href*="/messaging/thread/"]');
          const parentTids = new Set();
          for (const l of parentThreadLinks) {
            const m = l.href.match(/\/messaging\/thread\/([^/?#]+)/);
            if (m) parentTids.add(m[1]);
          }
          if (parentTids.size <= 1) {
            card = parent;
            continue;
          }
          break;
        }
        if (!card || card === document.body) { logReject('walked-to-body'); return; }

        const finalThreadLinks = card.querySelectorAll('a[href*="/messaging/thread/"]');
        const finalTids = new Set();
        for (const l of finalThreadLinks) {
          const m = l.href.match(/\/messaging\/thread\/([^/?#]+)/);
          if (m) finalTids.add(m[1]);
        }
        if (finalTids.size !== 1) { logReject('multi-thread-final'); return; }
        const cardTextLen = (card.textContent || '').trim().length;
        if (cardTextLen > 1500) { logReject('text-too-long'); return; }

        // === Reject NOTIFICATION-style content ===
        const cardText = (card.textContent || '');
        if (/\bsent the following message/i.test(cardText)) { logReject('notif-sent-msg'); return; }
        if (/\bview\s+\w+'?s\s+profile\b/i.test(cardText)) { logReject('notif-view-profile'); return; }
        if (/\bnotifications? total\b/i.test(cardText)) { logReject('notif-total'); return; }
        if (/\b\d+\s+(new\s+)?notifications?\b/i.test(cardText)) { logReject('notif-count'); return; }

        // Gather text nodes AND aria-label/alt attributes (names may live there)
        const texts = [];
        try {
          const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const t = (walker.currentNode.textContent || '').trim();
            if (t.length >= 1 && t.length < 300) texts.push(t);
          }
          // Also include aria-label and alt attributes (modern LinkedIn uses these for screen readers)
          card.querySelectorAll('[aria-label]').forEach(el => {
            const a = el.getAttribute('aria-label')?.trim();
            if (a && a.length >= 2 && a.length < 300) texts.push(a);
          });
          card.querySelectorAll('img[alt]').forEach(el => {
            const a = el.getAttribute('alt')?.trim();
            if (a && a.length >= 2 && a.length < 300) texts.push(a);
          });
        } catch (_) {}

        const NOISE = /^(Status is online|Active now|Online|·|—|–|\.{2,3}|\d+(st|nd|rd|th)?|Focused|Jobs|Unread|Connections?|InMail|Starred|All messages|Filter|Sort|notifications total|new notification|view profile|Open|Open conversation|Open chat|Conversation with)$/i;
        const filtered = texts.filter(t => !NOISE.test(t) && !/^[\s·•\-—–]+$/.test(t));
        const uniq = [];
        for (const t of filtered) {
          if (uniq[uniq.length - 1] !== t) uniq.push(t);
        }

        const senderName = uniq[0] || null;
        let preview = null;
        for (let i = 1; i < uniq.length; i++) {
          if (uniq[i] === senderName) continue;
          if (/^\w{3}\s+\d{1,2}$/.test(uniq[i])) continue;
          if (/^\d+(st|nd|rd|th)?$/.test(uniq[i])) continue;
          if (!preview || uniq[i].length > preview.length) preview = uniq[i];
        }

        if (!senderName || senderName.length < 2 || senderName.length > 100) { logReject('no-sender'); return; }
        if (/^(connections?|focused|jobs|unread|inmail|starred|messaging|sort by:?|filter|all|recently|search|notifications?)$/i.test(senderName)) { logReject('ui-label'); return; }
        if (/\d+\s+notifications?/i.test(senderName)) { logReject('notif-count-name'); return; }
        if (senderName === senderName.toLowerCase() && /\s/.test(senderName)) { logReject('all-lowercase'); return; }
        if (/:/.test(senderName)) { logReject('colon-in-name'); return; }

        seenThreads.add(threadId);

        let senderUrn = null, senderPublicId = null;
        const profileLink = card.querySelector('a[href*="/in/"]');
        if (profileLink) {
          const m = profileLink.href.match(/\/in\/([^/?#]+)/);
          if (m) {
            senderPublicId = decodeURIComponent(m[1]);
            senderUrn = `urn:li:fsd_profile:${senderPublicId}`;
            if (!seenPeople.has(senderUrn)) {
              seenPeople.add(senderUrn);
              const img = card.querySelector('img');
              people.push({
                urn: senderUrn,
                public_id: senderPublicId,
                name: senderName,
                headline: preview ? preview.slice(0, 100) : null,
                profile_url: `https://www.linkedin.com/in/${senderPublicId}/`,
                profile_img: img?.src || null,
              });
            }
          }
        }

        threads.push({
          external_id: threadId,
          title: senderName,
          participants: [senderName],
          participant_urns: senderUrn ? [senderUrn] : [],
          messages: preview ? [{
            content: preview,
            direction: 'inbound',
            sent_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
            sender: senderName,
            sender_urn: senderUrn,
          }] : [],
        });
      } catch (e) {
        /* skip thread */
      }
    });

    console.log(`[Reach 0.3] Messaging handler: ${threads.length} threads, ${people.length} senders (path: ${path}) | links seen: ${diagSeen}, rejected:`, diagReason);

    if (people.length > 0) await sendIngest('people', { people });
    if (threads.length > 0) await sendIngest('messages', { threads });
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
  async function autoWalkInbox(updateUi) {
    if (autoWalkRunning) return;
    autoWalkRunning = true;
    const maxThreads = 50;
    try {
      // Restrict to the conversation list region only — never click thread links inside open messages
      const listContainer =
        document.querySelector('[class*="conversation"], [aria-label*="onversation"]')?.closest('main, section, aside') ||
        document.querySelector('main aside') ||
        document.querySelector('main');
      if (!listContainer) { updateUi('Cannot find conversation list. Make sure messaging is open.'); return; }

      // Find all unique thread links in the list
      const threadLinks = listContainer.querySelectorAll('a[href*="/messaging/thread/"]');
      const uniqueIds = [];
      const seen = new Set();
      for (const a of threadLinks) {
        const m = a.href.match(/thread\/([^/?#]+)/);
        if (m && !seen.has(m[1])) {
          seen.add(m[1]);
          uniqueIds.push({ id: m[1], el: a });
        }
      }
      if (uniqueIds.length === 0) { updateUi('No conversations found in the inbox list.'); return; }

      const toVisit = uniqueIds.slice(0, maxThreads);
      let i = 0;
      for (const { id, el } of toVisit) {
        if (!autoWalkRunning) { updateUi('Stopped.'); break; }
        i++;
        updateUi(`Walking ${i}/${toVisit.length}…`);
        try { el.click(); } catch (_) {}
        await sleep(rand(4000, 6500));
        await handleMessagingPage();
      }
      const stats = await getStats();
      updateUi(`Done. ${stats.messages || 0} message events captured.`);
      markIndexed(location.pathname);
    } finally {
      autoWalkRunning = false;
    }
  }

  // ============================================================
  // FLOATING OVERLAY (shadow DOM, draggable)
  // ============================================================
  let overlayShadow = null;
  function injectOverlay() {
    if (document.getElementById('reach-overlay-host')) return;
    if (!document.body) return;
    const host = document.createElement('div');
    host.id = 'reach-overlay-host';
    host.style.cssText = `position:fixed;z-index:2147483647;bottom:24px;right:24px;`;
    const shadow = host.attachShadow({ mode: 'open' });
    overlayShadow = shadow;
    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
        .panel {
          background: #1C1E26; color: #F4EEE3;
          border-radius: 12px; padding: 12px 14px;
          min-width: 240px; max-width: 280px;
          font-size: 12px;
          box-shadow: 0 6px 28px rgba(0,0,0,0.22), 0 0 0 1px rgba(255,255,255,0.05);
          user-select: none;
        }
        .panel.collapsed { padding: 8px 12px; min-width: 0; cursor: pointer; }
        .panel.collapsed .body { display: none; }
        .panel.collapsed .header { cursor: pointer; }
        .header {
          display: flex; align-items: center; justify-content: space-between; gap: 8px;
          cursor: move;
        }
        .lhs { display: flex; align-items: center; gap: 6px; }
        .brand {
          font-family: 'Fraunces', Georgia, serif;
          font-style: italic; font-size: 16px; font-weight: 500;
        }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px currentColor; color: #22c55e; }
        .dot.idle { background: #eab308; color: #eab308; }
        .dot.err { background: #ef4444; color: #ef4444; }
        .dot.unknown { background: #6b7280; color: #6b7280; }
        .toggle {
          background: none; border: none; color: inherit; cursor: pointer;
          padding: 2px 6px; opacity: 0.5; font-size: 14px; line-height: 1;
        }
        .toggle:hover { opacity: 1; }
        .body { margin-top: 10px; }
        .stats {
          display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px;
          padding: 10px 0; border-top: 1px solid rgba(255,255,255,0.08);
        }
        .stat { display: flex; align-items: baseline; justify-content: space-between; gap: 6px; }
        .stat-l { opacity: 0.55; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; }
        .stat-v { font-weight: 600; font-size: 13px; }
        .action {
          display: block; width: 100%; margin-top: 8px; padding: 9px 10px;
          background: #F4EEE3; color: #1C1E26;
          border: none; border-radius: 6px;
          font: inherit; font-weight: 600; font-size: 12px;
          cursor: pointer; transition: opacity 0.15s;
        }
        .action:hover { opacity: 0.92; }
        .action.danger { background: #ef4444; color: #fff; }
        .action.secondary { background: rgba(255,255,255,0.1); color: #F4EEE3; }
        .action:disabled { opacity: 0.4; cursor: not-allowed; }
        .progress { margin-top: 6px; font-size: 10.5px; opacity: 0.75; min-height: 1em; line-height: 1.3; }
        .stale-note { font-size: 10px; opacity: 0.6; margin-top: 4px; line-height: 1.3; }
      </style>
      <div class="panel" id="panel">
        <div class="header" id="hdr">
          <div class="lhs">
            <span class="dot unknown" id="dot"></span>
            <span class="brand">Reach</span>
          </div>
          <button class="toggle" id="min" title="Minimize">—</button>
        </div>
        <div class="body" id="body">
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
    const panel = shadow.getElementById('panel');
    const hdr = shadow.getElementById('hdr');
    const min = shadow.getElementById('min');

    // Restore position
    chrome.storage.local.get('reachOverlayPos').then(({ reachOverlayPos }) => {
      if (reachOverlayPos) {
        host.style.right = 'auto';
        host.style.bottom = 'auto';
        host.style.left = reachOverlayPos.x + 'px';
        host.style.top = reachOverlayPos.y + 'px';
      }
    });

    // Restore collapsed state
    chrome.storage.local.get('reachOverlayCollapsed').then(({ reachOverlayCollapsed }) => {
      if (reachOverlayCollapsed) panel.classList.add('collapsed');
    });

    // Collapse toggle
    min.addEventListener('click', e => {
      e.stopPropagation();
      panel.classList.toggle('collapsed');
      chrome.storage.local.set({ reachOverlayCollapsed: panel.classList.contains('collapsed') });
    });
    // Click on collapsed panel reopens
    panel.addEventListener('click', e => {
      if (panel.classList.contains('collapsed')) {
        panel.classList.remove('collapsed');
        chrome.storage.local.set({ reachOverlayCollapsed: false });
      }
    });

    // Drag
    let dragging = false;
    let startX = 0, startY = 0, origX = 0, origY = 0;
    hdr.addEventListener('mousedown', e => {
      if (e.target === min) return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = host.getBoundingClientRect();
      origX = rect.left; origY = rect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const x = Math.max(8, Math.min(window.innerWidth - 60, origX + (e.clientX - startX)));
      const y = Math.max(8, Math.min(window.innerHeight - 60, origY + (e.clientY - startY)));
      host.style.right = 'auto'; host.style.bottom = 'auto';
      host.style.left = x + 'px'; host.style.top = y + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      const rect = host.getBoundingClientRect();
      chrome.storage.local.set({ reachOverlayPos: { x: rect.left, y: rect.top } });
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
    // Status dot
    const dot = $('dot');
    if (!stats.last_at) { dot.className = 'dot unknown'; }
    else {
      const mins = (Date.now() - new Date(stats.last_at).getTime()) / 60000;
      if (mins < 5) dot.className = 'dot';
      else if (mins < 60) dot.className = 'dot idle';
      else dot.className = 'dot unknown';
    }
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
      action.textContent = autoWalkRunning ? 'Stop' : 'Auto-index inbox';
      if (hoursSince !== null && hoursSince < 24 && !autoWalkRunning) {
        stale.textContent = `Indexed ${hoursSince < 1 ? Math.round(hoursSince*60) + 'm' : Math.round(hoursSince) + 'h'} ago — re-index if you'd like.`;
      }
      action.onclick = () => {
        if (autoWalkRunning) {
          autoWalkRunning = false;
          action.textContent = 'Auto-index inbox';
          return;
        }
        action.textContent = 'Stop';
        action.classList.add('danger');
        autoWalkInbox(text => {
          prog.textContent = text;
          if (!autoWalkRunning) {
            action.textContent = 'Auto-index inbox';
            action.classList.remove('danger');
            refreshOverlay();
          }
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
