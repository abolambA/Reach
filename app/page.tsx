import { createAdminClient } from '@/lib/supabase/server';
import Link from 'next/link';
import Nav from '@/components/nav';
import { STATUSES, formatRelativeDate, DEFAULT_OWNER_ID } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const admin = createAdminClient();

  const { data: accounts } = await admin
    .from('linkedin_accounts')
    .select('*')
    .eq('owner_id', DEFAULT_OWNER_ID)
    .order('created_at', { ascending: false });

  const accountIds = (accounts || []).map(a => a.id);
  const { data: threads } = accountIds.length
    ? await admin
        .from('threads')
        .select('id, account_id, last_message_at, decisions(status, category)')
        .in('account_id', accountIds)
    : { data: [] };

  const totalThreads = threads?.length || 0;
  const statusCounts: Record<string, number> = {};
  for (const t of threads || []) {
    const d = (t as any).decisions?.[0] || (t as any).decisions;
    const status = d?.status || 'pending';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }
  const handled = totalThreads - (statusCounts.pending || 0);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[1100px] mx-auto px-7 py-12 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
          Overview
        </div>
        <h1 className="serif text-[52px] font-normal leading-[1.05] tracking-tight mb-10">
          {totalThreads === 0 ? (
            <>Nothing in the inbox yet.</>
          ) : (
            <>
              <em className="font-light">{handled}</em> of {totalThreads} threads
              <br />concluded so far.
            </>
          )}
        </h1>

        {totalThreads === 0 ? (
          <div className="bg-[var(--paper-2)] rounded-2xl p-9 max-w-2xl">
            <h2 className="serif text-2xl font-normal mb-3">Get started in three steps</h2>
            <ol className="space-y-2 text-[var(--ink-2)] text-[15px] list-decimal list-inside leading-relaxed">
              <li>
                <Link href="/import" className="underline">Import messages</Link>
                {' '}— upload the LinkedIn CSV export, or connect via Unipile
              </li>
              <li>
                <Link href="/triage" className="underline">Triage</Link>
                {' '}— Lumen classifies each thread and drafts replies
              </li>
              <li>
                <Link href="/export" className="underline">Export</Link>
                {' '}— download decisions and drafts as CSV
              </li>
            </ol>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-3 mb-12">
              {STATUSES.map(s => (
                <div
                  key={s.id}
                  className="bg-[var(--paper-2)] rounded-xl p-4 border-l-[3px]"
                  style={{ borderLeftColor: s.color }}
                >
                  <div className="mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-3)] mb-1">
                    {s.label}
                  </div>
                  <div className="serif text-[28px] font-normal leading-none">
                    {statusCounts[s.id] || 0}
                  </div>
                </div>
              ))}
            </div>

            {accounts && accounts.length > 0 && (
              <div className="mb-12">
                <div className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
                  Connected accounts
                </div>
                <div className="space-y-2">
                  {accounts.map(a => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between bg-[var(--paper-2)] rounded-lg px-5 py-3.5"
                    >
                      <div>
                        <div className="font-medium text-[14px]">{a.label}</div>
                        <div className="mono text-[10px] text-[var(--ink-3)] uppercase tracking-[0.1em] mt-0.5">
                          {a.source} · last synced {formatRelativeDate(a.last_synced_at) || 'never'}
                        </div>
                      </div>
                      <Link
                        href="/import"
                        className="text-[11px] mono uppercase tracking-[0.1em] text-[var(--ink-2)] hover:underline"
                      >
                        Manage
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <Link
                href="/triage"
                className="inline-flex items-center gap-2 px-5 py-3 bg-[var(--ink)] text-[var(--paper)] rounded-full text-[13px] font-medium"
              >
                Continue triage →
              </Link>
              <Link
                href="/import"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-full border border-[var(--rule-2)] text-[var(--ink-2)] text-[13px]"
              >
                Import more
              </Link>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
