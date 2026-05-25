'use client';

import { useEffect, useState } from 'react';
import Nav from '@/components/nav';

type Goal = {
  id: string;
  label: string;
  kind: 'followers' | 'role_target' | 'named_person' | 'custom';
  criteria: any;
  target_value: number | null;
  current_value: number;
  status: string;
  notes: string | null;
  created_at: string;
};

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [planningId, setPlanningId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newKind, setNewKind] = useState<Goal['kind']>('role_target');
  const [newRole, setNewRole] = useState('');
  const [newIndustry, setNewIndustry] = useState('');
  const [newTarget, setNewTarget] = useState('');

  const load = async () => {
    const res = await fetch('/api/goals');
    const j = await res.json();
    setGoals(j.goals || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newLabel.trim()) return;
    const criteria: any = {};
    if (newKind === 'role_target' || newKind === 'followers' || newKind === 'custom') {
      if (newRole.trim()) {
        criteria.role_keywords = newRole.split(',').map(s => s.trim()).filter(Boolean);
      }
      if (newIndustry.trim()) criteria.industry = newIndustry.trim();
    }
    const target_value = newTarget.trim() ? parseInt(newTarget) : null;
    await fetch('/api/goals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel, kind: newKind, criteria, target_value }),
    });
    setNewLabel(''); setNewRole(''); setNewIndustry(''); setNewTarget('');
    setCreating(false);
    load();
  };

  const planForGoal = async (id: string) => {
    setPlanningId(id);
    await fetch('/api/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal_id: id }),
    });
    setPlanningId(null);
    alert('Planned. Check the Queue.');
  };

  const updateStatus = async (id: string, status: string) => {
    await fetch(`/api/goals/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this goal? Its queued actions stay.')) return;
    await fetch(`/api/goals/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[820px] mx-auto px-7 py-10 fade-in">
        <div className="flex justify-between items-baseline mb-3">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-1">Goals</div>
            <h1 className="serif text-[40px] italic font-normal leading-tight">What you're after.</h1>
          </div>
          <button onClick={() => setCreating(!creating)} className="px-4 py-2 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px] mono uppercase tracking-[0.1em]">
            {creating ? 'Cancel' : '+ New goal'}
          </button>
        </div>

        {creating && (
          <div className="bg-[var(--paper-2)] rounded-2xl p-5 mb-6 space-y-3 fade-in">
            <div>
              <label className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] block mb-1">Label</label>
              <input
                type="text"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                placeholder="Reach 10 healthcare CTOs"
                className="w-full px-3 py-2 bg-[var(--paper)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
              />
            </div>
            <div>
              <label className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] block mb-1">Kind</label>
              <div className="flex flex-wrap gap-2">
                {(['role_target','followers','named_person','custom'] as const).map(k => (
                  <button
                    key={k}
                    onClick={() => setNewKind(k)}
                    className={`px-3 py-1.5 rounded-full text-[11px] mono uppercase tracking-[0.1em] ${newKind === k ? 'bg-[var(--ink)] text-[var(--paper)]' : 'border border-[var(--rule-2)] text-[var(--ink-2)]'}`}
                  >{k.replace('_',' ')}</button>
                ))}
              </div>
            </div>
            {(newKind === 'role_target' || newKind === 'followers' || newKind === 'custom') && (
              <>
                <div>
                  <label className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] block mb-1">Role keywords (comma-separated)</label>
                  <input
                    type="text"
                    value={newRole}
                    onChange={e => setNewRole(e.target.value)}
                    placeholder="CTO, VP Engineering, Head of Product"
                    className="w-full px-3 py-2 bg-[var(--paper)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
                  />
                </div>
                <div>
                  <label className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] block mb-1">Industry filter</label>
                  <input
                    type="text"
                    value={newIndustry}
                    onChange={e => setNewIndustry(e.target.value)}
                    placeholder="healthcare"
                    className="w-full px-3 py-2 bg-[var(--paper)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
                  />
                </div>
              </>
            )}
            <div>
              <label className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] block mb-1">Target number (optional)</label>
              <input
                type="number"
                value={newTarget}
                onChange={e => setNewTarget(e.target.value)}
                placeholder="10"
                className="w-32 px-3 py-2 bg-[var(--paper)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
              />
            </div>
            <div className="pt-2">
              <button onClick={create} className="px-4 py-2 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px] font-medium">Create goal</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="text-[var(--ink-3)] mono text-[12px] uppercase tracking-[0.15em]">Loading…</div>
        ) : goals.length === 0 ? (
          <div className="bg-[var(--paper-2)] rounded-xl p-8 text-center">
            <div className="serif italic text-xl mb-2">No goals yet.</div>
            <div className="text-[13px] text-[var(--ink-3)]">Click <em>+ New goal</em> above to set one.</div>
          </div>
        ) : (
          <div className="space-y-3">
            {goals.map(g => {
              const progress = g.target_value ? Math.min(100, (g.current_value / g.target_value) * 100) : null;
              return (
                <div key={g.id} className="bg-[var(--paper-2)] rounded-2xl p-5">
                  <div className="flex items-baseline justify-between mb-2">
                    <div>
                      <div className="mono text-[9px] uppercase tracking-[0.15em] text-[var(--ink-3)] mb-1">{g.kind.replace('_',' ')}</div>
                      <div className="serif text-[20px]">{g.label}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => planForGoal(g.id)} disabled={planningId === g.id} className="px-3 py-1.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[11px] mono uppercase tracking-[0.1em] disabled:opacity-40">
                        {planningId === g.id ? 'Planning…' : 'Plan'}
                      </button>
                      <button onClick={() => updateStatus(g.id, g.status === 'active' ? 'paused' : 'active')} className="px-3 py-1.5 rounded-full border border-[var(--rule-2)] text-[11px] mono uppercase tracking-[0.1em]">
                        {g.status === 'active' ? 'Pause' : 'Activate'}
                      </button>
                      <button onClick={() => remove(g.id)} className="px-2 py-1.5 rounded-full text-[11px] text-[var(--accent)]">×</button>
                    </div>
                  </div>
                  {progress !== null && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[10px] mono text-[var(--ink-3)] mb-1">
                        <span>{g.current_value} / {g.target_value}</span>
                        <span>{progress.toFixed(0)}%</span>
                      </div>
                      <div className="h-1 bg-[var(--paper-3)] rounded overflow-hidden">
                        <div className="h-full bg-[var(--ink)] transition-all" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  )}
                  {g.criteria && Object.keys(g.criteria).length > 0 && (
                    <div className="mt-3 text-[11px] text-[var(--ink-3)] mono">
                      {g.criteria.role_keywords && (<>roles: {g.criteria.role_keywords.join(', ')} </>)}
                      {g.criteria.industry && (<>· industry: {g.criteria.industry}</>)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
