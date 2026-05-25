'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import Nav from '@/components/nav';
import { CATEGORIES, STATUSES, formatRelativeDate, type Status } from '@/lib/types';
import type { Thread, Decision, Message } from '@/lib/types';

const CAT_BY_ID = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const STATUS_BY_ID = Object.fromEntries(STATUSES.map(s => [s.id, s]));

export default function TriagePage() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState('status:pending');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Load threads + decisions on mount
  useEffect(() => {
    (async () => {
      const supabase = createClient();

      const { data: threadRows } = await supabase
        .from('threads')
        .select('*')
        .order('last_message_at', { ascending: false });
      const { data: decisionRows } = await supabase.from('decisions').select('*');

      setThreads((threadRows as Thread[]) || []);
      const dMap: Record<string, Decision> = {};
      for (const d of (decisionRows as Decision[]) || []) dMap[d.thread_id] = d;
      setDecisions(dMap);
      if (threadRows && threadRows.length > 0) setActiveId(threadRows[0].id);
      setLoading(false);
    })();
  }, []);

  // Load messages when active thread changes
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('thread_id', activeId)
        .order('sent_at', { ascending: true });
      setMessages((data as Message[]) || []);
    })();
  }, [activeId]);

  const activeThread = useMemo(() => threads.find(t => t.id === activeId), [threads, activeId]);
  const activeDecision = activeId ? decisions[activeId] : undefined;

  const stats = useMemo(() => {
    let handled = 0;
    for (const t of threads) {
      const s = decisions[t.id]?.status;
      if (s && s !== 'pending') handled++;
    }
    return { handled, total: threads.length };
  }, [threads, decisions]);

  // Counts by filter
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: threads.length, pending: 0 };
    for (const t of threads) {
      const d = decisions[t.id];
      const s = d?.status || 'pending';
      c[s] = (c[s] || 0) + 1;
      if (d?.category) c[`cat:${d.category}`] = (c[`cat:${d.category}`] || 0) + 1;
    }
    return c;
  }, [threads, decisions]);

  const filtered = useMemo(() => {
    return threads.filter(t => {
      const d = decisions[t.id];
      const status = d?.status || 'pending';
      if (filter === 'all') {}
      else if (filter.startsWith('status:')) {
        if (status !== filter.slice(7)) return false;
      } else if (filter.startsWith('cat:')) {
        if (d?.category !== filter.slice(4)) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${t.title || ''} ${(t.participants || []).join(' ')} ${t.preview || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [threads, decisions, filter, search]);

  // ============================================================
  // Mutations
  // ============================================================

  const saveDecision = useCallback(async (threadId: string, patch: Partial<Decision>) => {
    const current = decisions[threadId] || ({} as Decision);
    const next: Decision = { ...current, ...patch, thread_id: threadId, status: patch.status || current.status || 'pending' } as Decision;
    setDecisions(prev => ({ ...prev, [threadId]: next }));

    const supabase = createClient();
    await supabase.from('decisions').upsert({
      thread_id: threadId,
      ...patch,
    });
  }, [decisions]);

  // Debounced save for typing fields (draft_reply, notes)
  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const debouncedSave = useCallback((threadId: string, patch: Partial<Decision>) => {
    setDecisions(prev => ({
      ...prev,
      [threadId]: { ...(prev[threadId] || ({} as Decision)), ...patch, thread_id: threadId },
    }));
    const key = `${threadId}`;
    if (debounceTimers.current[key]) clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(async () => {
      const supabase = createClient();
      await supabase.from('decisions').upsert({ thread_id: threadId, ...patch });
    }, 600);
  }, []);

  const navigate = useCallback((dir: number) => {
    if (filtered.length === 0) return;
    const idx = filtered.findIndex(t => t.id === activeId);
    let next = idx + dir;
    if (next < 0) next = filtered.length - 1;
    if (next >= filtered.length) next = 0;
    setActiveId(filtered[next].id);
  }, [filtered, activeId]);

  const handleAction = useCallback((status: Status, extras: Partial<Decision> = {}) => {
    if (!activeId) return;
    saveDecision(activeId, { ...extras, status });
    setTimeout(() => navigate(1), 100);
  }, [activeId, saveDecision, navigate]);

  // ============================================================
  // Keyboard shortcuts
  // ============================================================
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); navigate(1); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); navigate(-1); }
      else if (e.key === 'd') handleAction('replied');
      else if (e.key === 'a') handleAction('archived');
      else if (e.key === 'f') handleAction('followup');
      else if (e.key === 's') handleAction('skipped');
      else if (e.key === '?') setShowShortcuts(true);
      else if (e.key === 'Escape') setShowShortcuts(false);
      else if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, handleAction]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <Nav />
        <div className="text-center py-32 text-[var(--ink-3)] mono text-[12px] uppercase tracking-[0.18em]">
          Loading inbox…
        </div>
      </div>
    );
  }

  if (threads.length === 0) {
    return (
      <div className="min-h-screen">
        <Nav />
        <div className="max-w-md mx-auto px-7 py-24 text-center fade-in">
          <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
            Nothing here yet
          </div>
          <h1 className="serif text-3xl font-normal italic mb-4">
            Your inbox is empty.
          </h1>
          <p className="text-[var(--ink-2)] text-[14px] mb-6">
            Import some messages first.
          </p>
          <button
            onClick={() => router.push('/import')}
            className="px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] rounded-full text-[13px] font-medium"
          >
            Go to import →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />

      {/* Stats strip */}
      <div className="border-b border-[var(--rule)] bg-[var(--paper)] px-7 py-2.5 flex items-center gap-5">
        <div className="mono text-[11px] text-[var(--ink-3)]">
          <span className="text-[var(--ink)]">{stats.handled}</span>
          <span className="text-[var(--ink-4)]"> / {stats.total} </span>
          handled
        </div>
        <div className="w-32 h-1 bg-[var(--paper-3)] rounded overflow-hidden">
          <div
            className="h-full bg-[var(--ink)] transition-all"
            style={{ width: `${stats.total ? (stats.handled / stats.total) * 100 : 0}%` }}
          />
        </div>
        <button
          onClick={async () => {
            const pendingThreadIds = threads
              .filter(t => {
                const d = decisions[t.id];
                return !d?.ai_classified_at;
              })
              .map(t => t.id)
              .slice(0, 30);
            if (pendingThreadIds.length === 0) {
              alert('All threads already have AI drafts.');
              return;
            }
            const ok = confirm(`Classify ${pendingThreadIds.length} pending thread${pendingThreadIds.length === 1 ? '' : 's'}? This will use Gemini to draft replies.`);
            if (!ok) return;
            const res = await fetch('/api/classify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ thread_ids: pendingThreadIds }),
            });
            if (res.ok) {
              alert('Done. Refresh the page to see the drafts.');
              window.location.reload();
            } else {
              const err = await res.text();
              alert('Classify failed: ' + err);
            }
          }}
          className="ml-auto px-3 py-1 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[11px] font-medium hover:opacity-90"
        >
          ✨ Classify pending
        </button>
        <button
          onClick={() => setShowShortcuts(true)}
          className="mono text-[10px] uppercase tracking-[0.12em] text-[var(--ink-3)] hover:text-[var(--ink)]"
        >
          shortcuts (?)
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* QUEUE COLUMN */}
        <aside className="w-72 border-r border-[var(--rule)] flex flex-col">
          <div className="p-3 border-b border-[var(--rule)] space-y-2">
            <input
              ref={searchRef}
              type="text"
              placeholder="Search…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 bg-[var(--paper-2)] border border-[var(--rule)] rounded text-[12px] outline-none focus:border-[var(--ink-3)]"
            />
            <div className="flex flex-wrap gap-1">
              <FilterPill label="All" count={counts.all} active={filter === 'all'} onClick={() => setFilter('all')} />
              {STATUSES.map(s => (
                <FilterPill
                  key={s.id}
                  label={s.label}
                  count={counts[s.id] || 0}
                  active={filter === `status:${s.id}`}
                  onClick={() => setFilter(`status:${s.id}`)}
                  color={s.color}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map(c =>
                counts[`cat:${c.id}`] ? (
                  <FilterPill
                    key={c.id}
                    label={c.short}
                    count={counts[`cat:${c.id}`]}
                    active={filter === `cat:${c.id}`}
                    onClick={() => setFilter(`cat:${c.id}`)}
                    color={c.color}
                  />
                ) : null,
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollable">
            {filtered.length === 0 ? (
              <div className="text-center py-12 text-[12px] text-[var(--ink-3)]">
                No threads match.
              </div>
            ) : (
              filtered.map(t => {
                const d = decisions[t.id];
                const isActive = t.id === activeId;
                const cat = d?.category && CAT_BY_ID[d.category];
                const status = d?.status || 'pending';
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveId(t.id)}
                    className={`w-full text-left p-3 border-b border-[var(--rule)] block relative ${
                      isActive ? 'bg-[var(--paper-2)]' : ''
                    }`}
                  >
                    {isActive && <div className="absolute left-0 top-0 bottom-0 w-[2px] bg-[var(--ink)]" />}
                    <div className="flex justify-between items-baseline mb-1">
                      <span
                        className={`text-[13px] font-medium truncate max-w-[170px] ${
                          status === 'pending' ? 'text-[var(--ink)]' : 'text-[var(--ink-3)]'
                        }`}
                      >
                        {t.participants?.[0] || t.title || '(untitled)'}
                      </span>
                      <span className="mono text-[10px] text-[var(--ink-4)] ml-2">
                        {formatRelativeDate(t.last_message_at)}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--ink-3)] leading-[1.4] line-clamp-2">
                      {d?.summary || t.preview}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {cat && (
                        <span
                          className="mono text-[9px] uppercase tracking-[0.1em] font-medium"
                          style={{ color: cat.color }}
                        >
                          ● {cat.short}
                        </span>
                      )}
                      {status !== 'pending' && (
                        <span
                          className="mono text-[9px] uppercase tracking-[0.1em]"
                          style={{ color: STATUS_BY_ID[status]?.color || '#6B7280' }}
                        >
                          · {STATUS_BY_ID[status]?.label}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* THREAD VIEW */}
        <main className="flex-1 overflow-y-auto scrollable min-w-0 p-8">
          {activeThread ? (
            <div key={activeThread.id} className="fade-in max-w-[640px]">
              <div className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-3)] mb-2">
                {(activeThread.participants || []).join(' · ') || 'Thread'} ·{' '}
                {activeThread.message_count} message{activeThread.message_count !== 1 ? 's' : ''} ·{' '}
                {formatRelativeDate(activeThread.last_message_at)}
              </div>
              <h2 className="serif text-3xl font-normal leading-tight tracking-tight mb-5">
                {activeThread.title}
              </h2>

              {activeDecision?.summary && (
                <div
                  className="p-4 bg-[var(--paper-2)] rounded-xl mb-6 border-l-[3px]"
                  style={{ borderLeftColor: (activeDecision.category && CAT_BY_ID[activeDecision.category]?.color) || '#6B7280' }}
                >
                  <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-1.5">
                    ✶ Lumen's read
                  </div>
                  <div className="text-[14px] leading-relaxed">{activeDecision.summary}</div>
                </div>
              )}

              <div className="space-y-0 mb-6">
                {messages.slice(-5).map((m, i) => (
                  <div
                    key={m.id}
                    className={`py-3 ${i > 0 ? 'border-t border-[var(--rule)]' : ''}`}
                  >
                    <div className="flex justify-between items-baseline mb-1">
                      <span className="text-[12px] font-medium">
                        {m.sender || 'Unknown'}
                        {m.direction === 'outbound' && (
                          <span className="mono text-[9px] ml-2 uppercase tracking-wider text-[var(--ink-4)]">
                            sent
                          </span>
                        )}
                      </span>
                      <span className="mono text-[10px] text-[var(--ink-4)]">
                        {m.sent_at
                          ? new Date(m.sent_at).toLocaleDateString('en-US', {
                              month: 'short', day: 'numeric', year: 'numeric',
                            })
                          : ''}
                      </span>
                    </div>
                    <div className="text-[14px] leading-relaxed text-[var(--ink-2)] whitespace-pre-wrap break-words">
                      {m.content}
                    </div>
                  </div>
                ))}
                {messages.length > 5 && (
                  <div className="mono text-[10px] text-[var(--ink-3)] pt-2">
                    ↑ {messages.length - 5} earlier messages
                  </div>
                )}
              </div>

              <div className="p-5 bg-[var(--paper-2)] rounded-xl">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)]">
                    ✎ Draft reply
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => {
                        const text = activeDecision?.draft_reply || activeDecision?.suggested_reply || '';
                        navigator.clipboard?.writeText(text);
                      }}
                      className="px-2.5 py-1 rounded-full border border-[var(--rule-2)] text-[11px] bg-[var(--paper)] hover:bg-[var(--paper-3)]"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => handleAction('replied')}
                      className="px-2.5 py-1 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[11px]"
                    >
                      Mark sent
                    </button>
                  </div>
                </div>
                <textarea
                  value={activeDecision?.draft_reply ?? activeDecision?.suggested_reply ?? ''}
                  onChange={e => debouncedSave(activeThread.id, { draft_reply: e.target.value })}
                  rows={6}
                  placeholder="Draft your reply…"
                  className="w-full p-3 text-[14px] leading-relaxed border border-[var(--rule)] rounded-lg bg-[var(--paper)] outline-none focus:border-[var(--ink-3)] resize-none"
                />
              </div>
            </div>
          ) : (
            <div className="text-[var(--ink-3)] text-[13px]">
              Select a thread from the queue, or use J/K to navigate.
            </div>
          )}
        </main>

        {/* ACTIONS PANEL */}
        <aside className="w-72 border-l border-[var(--rule)] p-6 space-y-6 overflow-y-auto scrollable">
          {activeThread && (
            <>
              <div>
                <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-2.5">
                  Category
                </div>
                <div className="flex flex-wrap gap-1">
                  {CATEGORIES.map(c => {
                    const isActive = activeDecision?.category === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => saveDecision(activeThread.id, { category: c.id })}
                        className="px-2.5 py-1 rounded-full text-[10px] mono uppercase tracking-[0.1em] border transition-colors"
                        style={{
                          borderColor: isActive ? c.color : 'var(--rule)',
                          background: isActive ? c.color : 'transparent',
                          color: isActive ? 'var(--paper)' : c.color,
                        }}
                      >
                        {c.short}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-2.5">
                  Status
                </div>
                <div className="space-y-1">
                  {STATUSES.map(s => {
                    const isActive = (activeDecision?.status || 'pending') === s.id;
                    return (
                      <button
                        key={s.id}
                        onClick={() => handleAction(s.id)}
                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] border transition-colors"
                        style={{
                          borderColor: isActive ? s.color : 'var(--rule)',
                          background: isActive ? s.color : 'transparent',
                          color: isActive ? 'var(--paper)' : 'var(--ink-2)',
                        }}
                      >
                        <span>{s.label}</span>
                        <span className="mono text-[9px] opacity-70">
                          {s.id === 'replied' ? 'D' : s.id === 'archived' ? 'A' : s.id === 'followup' ? 'F' : s.id === 'skipped' ? 'S' : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-2.5">
                  Private notes
                </div>
                <textarea
                  value={activeDecision?.notes || ''}
                  onChange={e => debouncedSave(activeThread.id, { notes: e.target.value })}
                  rows={3}
                  placeholder="Anything to remember…"
                  className="w-full p-2.5 text-[12px] leading-relaxed border border-[var(--rule)] rounded-lg bg-[var(--paper-2)] outline-none focus:border-[var(--ink-3)] resize-none"
                />
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  onClick={() => navigate(-1)}
                  className="flex-1 px-3 py-2 rounded-full border border-[var(--rule)] text-[11px] mono uppercase tracking-[0.1em]"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => navigate(1)}
                  className="flex-1 px-3 py-2 rounded-full border border-[var(--rule)] text-[11px] mono uppercase tracking-[0.1em]"
                >
                  Next →
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {showShortcuts && (
        <div
          onClick={() => setShowShortcuts(false)}
          className="fixed inset-0 bg-[rgba(28,30,38,0.5)] flex items-center justify-center z-50 p-5"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-[var(--paper)] rounded-2xl p-7 max-w-sm w-full"
          >
            <div className="serif text-2xl italic mb-4">Shortcuts</div>
            <table className="w-full">
              <tbody>
                {[
                  ['J / ↓', 'Next thread'],
                  ['K / ↑', 'Previous thread'],
                  ['D', 'Mark as replied'],
                  ['A', 'Archive'],
                  ['F', 'Follow-up'],
                  ['S', 'Skip'],
                  ['/', 'Focus search'],
                  ['Esc', 'Close panel'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="py-1.5">
                      <span className="mono text-[11px] px-2 py-1 rounded bg-[var(--paper-2)] border border-[var(--rule)]">
                        {k}
                      </span>
                    </td>
                    <td className="text-[13px] text-[var(--ink-2)] pl-3">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button
              onClick={() => setShowShortcuts(false)}
              className="w-full mt-4 px-4 py-2 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[13px]"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  label, count, active, onClick, color,
}: {
  label: string; count: number; active: boolean; onClick: () => void; color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className="px-2 py-0.5 rounded-full text-[10px] mono uppercase tracking-[0.1em] border inline-flex items-center gap-1 transition-colors"
      style={{
        borderColor: active ? 'var(--ink)' : 'var(--rule)',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--paper)' : color || 'var(--ink-2)',
      }}
    >
      {label} <span className="opacity-60">{count}</span>
    </button>
  );
}
