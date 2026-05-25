import { createAdminClient } from '@/lib/supabase/server';
import Link from 'next/link';
import Nav from '@/components/nav';
import { formatRelativeDate } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const admin = createAdminClient();

  const [{ count: peopleCount }, { count: edgesCount }, { count: postsCount }, { count: actionsCount }, { count: goalsCount }, { data: self }, { data: lastIngest }] = await Promise.all([
    admin.from('people').select('*', { count: 'exact', head: true }).eq('is_self', false),
    admin.from('edges').select('*', { count: 'exact', head: true }),
    admin.from('posts').select('*', { count: 'exact', head: true }),
    admin.from('actions').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
    admin.from('goals').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('people').select('name, public_id, headline').eq('is_self', true).maybeSingle(),
    admin.from('ingest_log').select('kind, count, at').order('at', { ascending: false }).limit(5),
  ]);

  const noData = (peopleCount || 0) === 0 && (edgesCount || 0) === 0;

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[1100px] mx-auto px-7 py-12 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
          Reach · Overview
        </div>
        <h1 className="serif text-[52px] font-normal leading-[1.05] tracking-tight mb-3">
          {noData ? <>The graph is empty.</> : <>Your network, <em className="font-light">mapped.</em></>}
        </h1>
        <p className="text-[var(--ink-2)] text-[15px] leading-relaxed mb-10 max-w-2xl">
          {noData
            ? 'Install the Chrome extension, browse LinkedIn normally, and watch the data flow in.'
            : `${peopleCount?.toLocaleString()} people · ${edgesCount?.toLocaleString()} edges · ${postsCount?.toLocaleString()} posts. Browse, search, plan.`}
        </p>

        {self ? (
          <div className="bg-[var(--paper-2)] rounded-xl p-4 mb-8 inline-flex items-baseline gap-3">
            <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)]">You</div>
            <div className="serif italic text-[18px]">{self.name}</div>
            {self.headline && <div className="text-[12px] text-[var(--ink-3)]">{self.headline}</div>}
          </div>
        ) : (
          <div className="bg-[var(--paper-2)] rounded-xl p-5 mb-8 max-w-lg">
            <div className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-1">
              Self not identified
            </div>
            <p className="text-[14px]">
              Visit your own LinkedIn profile with the extension installed — it'll flag you as
              "self" so the path-finder knows where to start from.
            </p>
          </div>
        )}

        <div className="grid grid-cols-5 gap-3 mb-12">
          <Card label="People" value={peopleCount || 0} href="/network" />
          <Card label="Connections" value={edgesCount || 0} href="/network" />
          <Card label="Posts" value={postsCount || 0} />
          <Card label="Goals" value={goalsCount || 0} href="/goals" />
          <Card label="Queue" value={actionsCount || 0} href="/queue" accent />
        </div>

        <div className="grid grid-cols-3 gap-4 mb-12">
          <Link href="/queue" className="bg-[var(--ink)] text-[var(--paper)] rounded-2xl p-6 hover:opacity-95 transition-opacity">
            <div className="mono text-[9px] uppercase tracking-[0.2em] opacity-70 mb-2">Today</div>
            <div className="serif text-2xl italic mb-1">Run the queue</div>
            <div className="text-[12px] opacity-80">{actionsCount || 0} pending actions, drafted in your voice.</div>
          </Link>
          <Link href="/search" className="bg-[var(--paper-2)] rounded-2xl p-6 hover:bg-[var(--paper-3)] transition-colors">
            <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-2">Path-finding</div>
            <div className="serif text-2xl italic mb-1">Reach anyone</div>
            <div className="text-[12px] text-[var(--ink-2)]">Find the shortest path to any name in the network.</div>
          </Link>
          <Link href="/goals" className="bg-[var(--paper-2)] rounded-2xl p-6 hover:bg-[var(--paper-3)] transition-colors">
            <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-2">Strategy</div>
            <div className="serif text-2xl italic mb-1">Set goals</div>
            <div className="text-[12px] text-[var(--ink-2)]">Reach roles, build followings, grow into target circles.</div>
          </Link>
        </div>

        {lastIngest && lastIngest.length > 0 && (
          <div>
            <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
              Recent ingest
            </div>
            <table className="w-full text-[12px]">
              <tbody>
                {lastIngest.map((l, i) => (
                  <tr key={i} className="border-b border-[var(--rule)]">
                    <td className="py-2 mono uppercase tracking-[0.1em] text-[var(--ink-2)] w-32">{l.kind}</td>
                    <td className="py-2 text-[var(--ink-3)]">{l.count} items</td>
                    <td className="py-2 mono text-[var(--ink-4)] text-right">{formatRelativeDate(l.at)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}

function Card({ label, value, href, accent }: { label: string; value: number; href?: string; accent?: boolean }) {
  const inner = (
    <div className={`rounded-xl p-4 border-l-[3px] ${accent ? 'bg-[var(--ink)] text-[var(--paper)] border-l-[var(--paper)]' : 'bg-[var(--paper-2)] border-l-[var(--ink-3)]'}`}>
      <div className="mono text-[9px] uppercase tracking-[0.18em] opacity-70 mb-1">{label}</div>
      <div className="serif text-[28px] font-normal leading-none">{value.toLocaleString()}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
