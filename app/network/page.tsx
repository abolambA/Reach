'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Nav from '@/components/nav';

type Person = {
  urn: string;
  name: string | null;
  headline: string | null;
  company: string | null;
  profile_url: string | null;
  profile_img: string | null;
  is_first_degree: boolean;
  derived_categories: string[];
};

export default function NetworkPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'first_degree'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const url = new URL('/api/search/people', window.location.origin);
      if (search.trim()) url.searchParams.set('q', search.trim());
      url.searchParams.set('limit', '50');
      const res = await fetch(url);
      const j = await res.json();
      setPeople(j.people || []);
      setLoading(false);
    })();
  }, [search]);

  const filtered = filter === 'first_degree' ? people.filter(p => p.is_first_degree) : people;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[1100px] mx-auto px-7 py-10 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">Network</div>
        <h1 className="serif text-[44px] italic font-normal leading-tight mb-3">Everyone Reach has seen.</h1>
        <p className="text-[var(--ink-2)] text-[14px] mb-7 max-w-xl">
          Every profile the extension has indexed from your LinkedIn browsing. Filter by 1st-degree
          to see your direct connections.
        </p>

        <div className="flex items-center gap-3 mb-6">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name, headline, or company…"
            className="flex-1 px-4 py-2.5 bg-[var(--paper-2)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
          />
          <div className="flex gap-1">
            <button
              onClick={() => setFilter('all')}
              className={`px-3 py-1.5 rounded-full text-[11px] mono uppercase tracking-[0.1em] ${filter === 'all' ? 'bg-[var(--ink)] text-[var(--paper)]' : 'border border-[var(--rule)] text-[var(--ink-2)]'}`}
            >All</button>
            <button
              onClick={() => setFilter('first_degree')}
              className={`px-3 py-1.5 rounded-full text-[11px] mono uppercase tracking-[0.1em] ${filter === 'first_degree' ? 'bg-[var(--ink)] text-[var(--paper)]' : 'border border-[var(--rule)] text-[var(--ink-2)]'}`}
            >1st-degree</button>
          </div>
        </div>

        {loading ? (
          <div className="text-[var(--ink-3)] text-[12px] mono uppercase tracking-[0.15em]">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="bg-[var(--paper-2)] rounded-xl p-8 text-center">
            <div className="serif italic text-xl mb-2">No matches yet.</div>
            <div className="text-[13px] text-[var(--ink-3)]">
              {people.length === 0
                ? 'Browse LinkedIn with the extension installed and people will appear here.'
                : 'Try a different filter or search term.'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map(p => (
              <div key={p.urn} className="bg-[var(--paper-2)] rounded-xl p-4 flex items-start gap-3">
                {p.profile_img ? (
                  <img src={p.profile_img} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-[var(--paper-3)] flex-shrink-0 flex items-center justify-center text-[var(--ink-3)] mono text-[12px]">
                    {(p.name || '?').slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="font-medium text-[14px] truncate">{p.name || '(no name)'}</div>
                    {p.is_first_degree && (
                      <span className="mono text-[8px] uppercase tracking-[0.15em] text-[var(--success)] flex-shrink-0">1st</span>
                    )}
                  </div>
                  {p.headline && <div className="text-[12px] text-[var(--ink-2)] line-clamp-2 mt-0.5">{p.headline}</div>}
                  {p.company && <div className="mono text-[10px] uppercase tracking-[0.1em] text-[var(--ink-3)] mt-1">{p.company}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
