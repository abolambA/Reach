'use client';

import { useEffect, useState } from 'react';
import Nav from '@/components/nav';

type Action = {
  id: string;
  goal_id: string | null;
  kind: string;
  target_urn: string | null;
  draft: string | null;
  rationale: string | null;
  status: string;
  priority: number;
  created_at: string;
  target?: {
    urn: string;
    name: string | null;
    headline: string | null;
    company: string | null;
    profile_img: string | null;
    profile_url: string | null;
  };
  via?: { urn: string; name: string | null };
  goal?: { id: string; label: string };
};

const KIND_LABELS: Record<string, string> = {
  reply: 'Reply',
  outreach: 'Outreach',
  intro_request: 'Intro request',
  comment: 'Comment',
  react: 'React',
  follow: 'Follow',
  connect: 'Connect',
};

export default function QueuePage() {
  const [actions, setActions] = useState<Action[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [planning, setPlanning] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch('/api/actions?status=queued&limit=50');
    const j = await res.json();
    setActions(j.actions || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const update = async (id: string, patch: any) => {
    await fetch(`/api/actions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  };

  const approve = async (a: Action) => {
    await update(a.id, { status: 'approved' });
    if (a.draft) navigator.clipboard?.writeText(a.draft);
    // open LinkedIn — message or profile
    if (a.target?.profile_url) {
      window.open(a.target.profile_url, '_blank');
    }
    setActions(actions.filter(x => x.id !== a.id));
  };

  const markSent = async (a: Action) => {
    await update(a.id, { status: 'sent' });
    setActions(actions.filter(x => x.id !== a.id));
  };

  const skip = async (a: Action) => {
    await update(a.id, { status: 'skipped' });
    setActions(actions.filter(x => x.id !== a.id));
  };

  const startEdit = (a: Action) => {
    setEditing(a.id);
    setEditDraft(a.draft || '');
  };

  const saveEdit = async (a: Action) => {
    await update(a.id, { draft: editDraft });
    setActions(actions.map(x => x.id === a.id ? { ...x, draft: editDraft } : x));
    setEditing(null);
  };

  const plan = async () => {
    setPlanning(true);
    await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    setPlanning(false);
    load();
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[720px] mx-auto px-7 py-10 fade-in">
        <div className="flex justify-between items-baseline mb-3">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-1">Queue</div>
            <h1 className="serif text-[40px] italic font-normal leading-tight">Today's actions.</h1>
          </div>
          <button
            onClick={plan}
            disabled={planning}
            className="px-4 py-2 rounded-full border border-[var(--rule-2)] text-[12px] mono uppercase tracking-[0.1em] text-[var(--ink-2)] hover:bg-[var(--paper-2)] disabled:opacity-40"
          >
            {planning ? 'Planning…' : 'Plan new actions'}
          </button>
        </div>

        <p className="text-[var(--ink-2)] text-[13px] mb-8 max-w-xl">
          Each card is a drafted action. Tap Approve to copy to clipboard and open LinkedIn —
          you paste and send manually. Reach tracks what you've done.
        </p>

        {loading ? (
          <div className="text-[var(--ink-3)] mono text-[12px] uppercase tracking-[0.15em]">Loading…</div>
        ) : actions.length === 0 ? (
          <div className="bg-[var(--paper-2)] rounded-xl p-8 text-center">
            <div className="serif italic text-xl mb-2">Queue's empty.</div>
            <div className="text-[13px] text-[var(--ink-3)] mb-4">
              Set a goal first, then tap <em>Plan new actions</em> above.
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {actions.map(a => (
              <div key={a.id} className="bg-[var(--paper-2)] rounded-2xl p-5 fade-in">
                <div className="flex items-start gap-3 mb-3">
                  {a.target?.profile_img ? (
                    <img src={a.target.profile_img} alt="" className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-[var(--paper-3)] flex items-center justify-center text-[var(--ink-3)] mono text-[12px]">
                      {(a.target?.name || '?').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="mono text-[9px] uppercase tracking-[0.15em] text-[var(--ink-3)]">
                        {KIND_LABELS[a.kind] || a.kind}
                      </span>
                      {a.goal && (
                        <span className="mono text-[9px] uppercase tracking-[0.15em] text-[var(--gold)]">
                          · {a.goal.label}
                        </span>
                      )}
                    </div>
                    <div className="font-medium text-[15px]">{a.target?.name || '(unknown)'}</div>
                    {a.target?.headline && (
                      <div className="text-[12px] text-[var(--ink-2)] line-clamp-1">{a.target.headline}</div>
                    )}
                    {a.via && (
                      <div className="text-[11px] text-[var(--ink-3)] mt-1">
                        → via <span className="font-medium text-[var(--ink-2)]">{a.via.name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {a.rationale && (
                  <div className="text-[11px] text-[var(--ink-3)] italic mb-3 px-1">{a.rationale}</div>
                )}

                {editing === a.id ? (
                  <textarea
                    value={editDraft}
                    onChange={e => setEditDraft(e.target.value)}
                    rows={5}
                    className="w-full p-3 text-[14px] leading-relaxed border border-[var(--rule)] rounded-lg bg-[var(--paper)] outline-none focus:border-[var(--ink-3)] resize-none mb-3"
                  />
                ) : (
                  <div className="bg-[var(--paper)] rounded-lg p-3 text-[14px] leading-relaxed whitespace-pre-wrap mb-3">
                    {a.draft || <em className="text-[var(--ink-3)]">(no draft)</em>}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {editing === a.id ? (
                    <>
                      <button onClick={() => saveEdit(a)} className="px-3 py-1.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px]">Save</button>
                      <button onClick={() => setEditing(null)} className="px-3 py-1.5 rounded-full border border-[var(--rule-2)] text-[12px]">Cancel</button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => approve(a)} className="px-3 py-1.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px] font-medium">
                        Copy & open LinkedIn
                      </button>
                      <button onClick={() => markSent(a)} className="px-3 py-1.5 rounded-full border border-[var(--success)] text-[var(--success)] text-[12px]">
                        Mark sent
                      </button>
                      <button onClick={() => startEdit(a)} className="px-3 py-1.5 rounded-full border border-[var(--rule-2)] text-[12px]">
                        Edit
                      </button>
                      <button onClick={() => skip(a)} className="px-3 py-1.5 rounded-full border border-[var(--rule-2)] text-[12px] text-[var(--ink-3)] ml-auto">
                        Skip
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
