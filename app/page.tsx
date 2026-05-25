import { createAdminClient } from '@/lib/supabase/server';
import Link from 'next/link';
import Nav from '@/components/nav';
import { formatRelativeDate } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const admin = createAdminClient();

  const [
    { count: peopleCount },
    { count: edgesCount },
    { count: postsCount },
    { count: actionsCount },
    { count: goalsCount },
    { count: messagesCount },
    { data: self },
    { data: lastIngest },
    { data: mostRecentIngest },
  ] = await Promise.all([
    admin.from('people').select('*', { count: 'exact', head: true }).eq('is_self', false),
    admin.from('edges').select('*', { count: 'exact', head: true }),
    admin.from('posts').select('*', { count: 'exact', head: true }),
    admin.from('actions').select('*', { count: 'exact', head: true }).eq('status', 'queued'),
    admin.from('goals').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    admin.from('messages').select('*', { count: 'exact', head: true }),
    admin.from('people').select('name, public_id, headline').eq('is_self', true).maybeSingle(),
    admin.from('ingest_log').select('kind, count, at').order('at', { ascending: false }).limit(6),
    admin.from('ingest_log').select('at').order('at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  const noData = (peopleCount || 0) === 0 && (edgesCount || 0) === 0 && (messagesCount || 0) === 0;

  // Extension status: based on most recent ingest event
  const lastIngestTime = mostRecentIngest?.at ? new Date(mostRecentIngest.at) : null;
  const minutesSinceLastIngest = lastIngestTime
    ? Math.floor((Date.now() - lastIngestTime.getTime()) / 60000)
    : null;
  const extensionState: 'never' | 'active' | 'idle' | 'stale' =
    !lastIngestTime ? 'never'
    : minutesSinceLastIngest! < 60 ? 'active'
    : minutesSinceLastIngest! < 60 * 24 ? 'idle'
    : 'stale';

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
            ? 'Install the Chrome extension. Browse LinkedIn normally. Data flows in automatically — no CSVs, no exports, no manual steps.'
            : `${peopleCount?.toLocaleString()} people · ${edgesCount?.toLocaleString()} edges · ${messagesCount?.toLocaleString()} messages · ${postsCount?.toLocaleString()} posts. Browse, search, plan.`}
        </p>

        {/* Empty-state setup checklist */}
        {noData && (
          <div className="bg-[var(--paper-2)] border-l-[3px] border-[var(--accent)] rounded-xl p-6 mb-10 max-w-2xl">
            <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-4">
              Setup checklist
            </div>
            <ol className="space-y-3 text-[14px]">
              <li className="flex gap-3">
                <span className="mono text-[var(--ink-3)] mt-0.5">1</span>
                <div>
                  <div className="font-medium">Install the Chrome extension</div>
                  <div className="text-[12px] text-[var(--ink-3)] mt-0.5">
                    chrome://extensions → Developer mode → Load unpacked → select the extension folder.
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--ink-3)] mt-0.5">2</span>
                <div>
                  <div className="font-medium">Configure it</div>
                  <div className="text-[12px] text-[var(--ink-3)] mt-0.5">
                    Click the extension icon → paste this site's URL + your ingest token → Save → Test connection.
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--ink-3)] mt-0.5">3</span>
                <div>
                  <div className="font-medium">Visit your own LinkedIn profile</div>
                  <div className="text-[12px] text-[var(--ink-3)] mt-0.5">
                    The extension flags you as "self" so path-finding has a starting node.
                  </div>
                </div>
              </li>
              <li className="flex gap-3">
                <span className="mono text-[var(--ink-3)] mt-0.5">4</span>
                <div>
                  <div className="font-medium">Browse normally</div>
                  <div className="text-[12px] text-[var(--ink-3)] mt-0.5">
                    Connections page, profiles, messaging, feed — the extension indexes everything you see.
                  </div>
                </div>
              </li>
            </ol>
            <div className="mt-5 pt-4 border-t border-[var(--rule)] text-[11px] text-[var(--ink-3)]">
              No CSV exports. No manual uploads. The platform unifies everything the extension sees into a single graph.
              {' '}<Link href="/import" className="underline">Backup CSV import →</Link>
            </div>
          </div>
        )}

        {/* Self identification */}
        {!noData && (self ? (
          <div className="bg-[var(--paper-2)] rounded-xl p-4 mb-8 inline-flex items-baseline gap-3">
            <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)]">You</div>
            <div className="serif italic text-[18px]">{self.name}</div>
            {self.headline && <div className="text-[12px] text-[var(--ink-3)]">{self.headline}</div>}
          </div>
        ) : (
          <div className="bg-[var(--paper-2)] rounded-xl p-5 mb-8 max-w-lg border-l-[3px] border-[var(--accent)]">
            <div className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-1">
              Self not identified yet
            </div>
            <p className="text-[14px]">
              Open your own LinkedIn profile with the extension active — it'll flag you as "self"
              so the path-finder knows where to start.
            </p>
          </div>
        ))}

        {/* Stat cards */}
        {!noData && (
          <div className="grid grid-cols-5 gap-3 mb-12">
            <Card label="People" value={peopleCount || 0} href="/network" />
            <Card label="Connections" value={edgesCount || 0} href="/network" />
            <Card label="Messages" value={messagesCount || 0} href="/triage" />
            <Card label="Goals" value={goalsCount || 0} href="/goals" />
            <Card label="Queue" value={actionsCount || 0} href="/queue" accent />
          </div>
        )}

        {/* Action shortcuts */}
        {!noData && (
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
        )}

        {/* Data source status — the unification proof */}
        <div className="border-t border-[var(--rule)] pt-8">
          <div className="flex items-baseline justify-between mb-4">
            <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)]">
              Data source · Chrome extension
            </div>
            <ExtensionStatusBadge state={extensionState} mins={minutesSinceLastIngest} />
          </div>

          {lastIngest && lastIngest.length > 0 ? (
            <table className="w-full text-[12px]">
              <tbody>
                {lastIngest.map((l, i) => (
                  <tr key={i} className="border-b border-[var(--rule)]">
                    <td className="py-2 mono uppercase tracking-[0.1em] text-[var(--ink-2)] w-40">{l.kind}</td>
                    <td className="py-2 text-[var(--ink-3)]">{l.count} items</td>
                    <td className="py-2 mono text-[var(--ink-4)] text-right">{formatRelativeDate(l.at)} ago</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-[var(--ink-3)] italic">
              No ingest events yet. Once the extension is installed and configured, browsing LinkedIn
              will populate this list automatically.
            </p>
          )}

          <div className="mt-5 text-[11px] text-[var(--ink-4)]">
            All data — connections, messages, posts, interactions — flows through the extension into a unified graph.
            {' '}<Link href="/import" className="underline hover:text-[var(--ink-2)]">Need to import a CSV instead? →</Link>
          </div>
        </div>
      </main>
    </div>
  );
}

function ExtensionStatusBadge({ state, mins }: { state: 'never' | 'active' | 'idle' | 'stale'; mins: number | null }) {
  const config = {
    never: { label: 'Not connected', color: 'var(--ink-4)', dot: '○' },
    active: { label: mins! < 1 ? 'Active now' : `Active · ${mins}m ago`, color: '#22c55e', dot: '●' },
    idle: { label: `Idle · ${Math.floor(mins! / 60)}h ago`, color: 'var(--accent)', dot: '●' },
    stale: { label: 'Stale · 24h+ ago', color: 'var(--ink-4)', dot: '●' },
  }[state];

  return (
    <div className="inline-flex items-center gap-2 text-[11px]">
      <span style={{ color: config.color }}>{config.dot}</span>
      <span className="mono uppercase tracking-[0.12em]" style={{ color: config.color }}>{config.label}</span>
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
