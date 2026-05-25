'use client';

import { useState } from 'react';
import Nav from '@/components/nav';

type Person = {
  urn: string;
  name: string | null;
  headline: string | null;
  company: string | null;
  profile_img: string | null;
  is_first_degree: boolean;
};

type PathResult = {
  path: string[] | null;
  length: number | null;
  people: Person[];
};

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [pathResult, setPathResult] = useState<PathResult | null>(null);
  const [target, setTarget] = useState<Person | null>(null);
  const [pathLoading, setPathLoading] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  const searchPeople = async () => {
    if (!query.trim()) return;
    setSearching(true);
    const res = await fetch(`/api/search/people?q=${encodeURIComponent(query.trim())}&limit=10`);
    const j = await res.json();
    setResults(j.people || []);
    setSearching(false);
  };

  const findPath = async (person: Person) => {
    setTarget(person);
    setPathLoading(true);
    setPathError(null);
    setPathResult(null);
    const res = await fetch('/api/path', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_urn: person.urn, max_depth: 4 }),
    });
    const j = await res.json();
    setPathLoading(false);
    if (!res.ok) {
      setPathError(j.error || 'Path search failed');
      return;
    }
    setPathResult(j);
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[820px] mx-auto px-7 py-12 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">Path-finder</div>
        <h1 className="serif text-[44px] italic font-normal leading-tight mb-3">Reach anyone.</h1>
        <p className="text-[var(--ink-2)] text-[14px] mb-7 max-w-xl">
          Type a name. Reach searches the indexed graph and shows the shortest chain of
          connections from you to them.
        </p>

        <div className="flex gap-2 mb-6">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchPeople()}
            placeholder="Search a name, role, company, or paste a LinkedIn profile URL…"
            className="flex-1 px-4 py-3 bg-[var(--paper-2)] border border-[var(--rule)] rounded-lg text-[15px] outline-none focus:border-[var(--ink-3)]"
          />
          <button
            onClick={searchPeople}
            disabled={!query.trim() || searching}
            className="px-5 py-3 bg-[var(--ink)] text-[var(--paper)] rounded-full text-[13px] font-medium disabled:opacity-40"
          >
            {searching ? '…' : 'Search'}
          </button>
        </div>
        <div className="text-[11px] text-[var(--ink-3)] -mt-3 mb-6">
          Tip: paste a full LinkedIn URL like <span className="mono">linkedin.com/in/sarah-chen</span> for exact-match lookups (no name guessing).
        </div>

        {!searching && query && results.length === 0 && (
          <div className="bg-[var(--paper-2)] border-l-[3px] border-[var(--accent)] rounded-xl p-5 mb-8">
            <div className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-2">
              Not in your indexed graph yet
            </div>
            <p className="text-[13px] text-[var(--ink-2)] leading-relaxed">
              Reach only sees people the extension has already indexed from your normal LinkedIn browsing.
              To add this person: open their LinkedIn profile in your browser (with the extension active), wait 3 seconds for the page to settle,
              then come back here and search again.
            </p>
            <p className="text-[12px] text-[var(--ink-3)] mt-3">
              For finding people in adjacent networks: visit one of your 1st-degree connection's profiles whose connections page might include this person.
              Each profile you visit deepens the graph.
            </p>
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2 mb-8">
            <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-1">
              Pick a target
            </div>
            {results.map(p => (
              <button
                key={p.urn}
                onClick={() => findPath(p)}
                className={`w-full text-left bg-[var(--paper-2)] hover:bg-[var(--paper-3)] rounded-xl p-3 flex items-center gap-3 transition-colors ${target?.urn === p.urn ? 'ring-2 ring-[var(--ink)]' : ''}`}
              >
                {p.profile_img ? (
                  <img src={p.profile_img} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-[var(--paper-3)] flex items-center justify-center text-[var(--ink-3)] mono text-[11px]">
                    {(p.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium">{p.name}</div>
                  {p.headline && <div className="text-[12px] text-[var(--ink-2)] line-clamp-1">{p.headline}</div>}
                </div>
                {p.is_first_degree && (
                  <span className="mono text-[8px] uppercase tracking-[0.15em] text-[var(--success)]">1st</span>
                )}
              </button>
            ))}
          </div>
        )}

        {pathLoading && (
          <div className="text-[var(--ink-3)] mono text-[11px] uppercase tracking-[0.15em]">
            Walking the graph…
          </div>
        )}

        {pathError && (
          <div className="bg-[rgba(184,84,80,0.06)] border-l-[3px] border-[var(--accent)] rounded-xl p-4 text-[13px] text-[var(--accent)]">
            {pathError}
          </div>
        )}

        {pathResult && pathResult.path === null && (
          <div className="bg-[var(--paper-2)] rounded-xl p-6">
            <div className="serif italic text-xl mb-2">No path yet.</div>
            <div className="text-[13px] text-[var(--ink-2)] leading-relaxed">
              Reach hasn't indexed enough of your network to find a connection to{' '}
              <strong>{target?.name}</strong>. To expand: visit some of your 1st-degree
              connections' profiles on LinkedIn — when you scroll through their visible
              connections, the extension indexes them, and the graph fills in. Try the path again
              in a few days.
            </div>
          </div>
        )}

        {pathResult && pathResult.path && (
          <div className="fade-in">
            <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
              {pathResult.length} {pathResult.length === 1 ? 'hop' : 'hops'} to {target?.name}
            </div>
            <div className="space-y-3">
              {pathResult.people.map((p, i) => (
                <div key={p.urn}>
                  <div className="bg-[var(--paper-2)] rounded-xl p-4 flex items-center gap-3">
                    {p.profile_img ? (
                      <img src={p.profile_img} alt="" className="w-12 h-12 rounded-full object-cover" />
                    ) : (
                      <div className="w-12 h-12 rounded-full bg-[var(--paper-3)] flex items-center justify-center text-[var(--ink-3)] mono text-[12px]">
                        {(p.name || '?').slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-[15px]">
                        {i === 0 ? 'You' : p.name}
                      </div>
                      {p.headline && <div className="text-[12px] text-[var(--ink-2)] line-clamp-1">{p.headline}</div>}
                    </div>
                    <span className="mono text-[9px] uppercase tracking-[0.15em] text-[var(--ink-3)]">
                      {i === 0 ? 'Start' : i === pathResult.people.length - 1 ? 'Target' : `Hop ${i}`}
                    </span>
                  </div>
                  {i < pathResult.people.length - 1 && (
                    <div className="flex justify-center py-1 text-[var(--ink-4)] text-[18px]">↓</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-6 text-[12px] text-[var(--ink-3)] leading-relaxed">
              The shortest path Reach knows about. Set this as a goal on the Goals page to get a
              drafted intro-request queued automatically.
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
