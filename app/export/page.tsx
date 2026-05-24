'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import Nav from '@/components/nav';
import { STATUSES } from '@/lib/types';

export default function ExportPage() {
    const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();

      const { data: rows } = await supabase
        .from('threads')
        .select('id, external_id, title, participants, last_message_at, message_count, preview, decisions(*)')
        .order('last_message_at', { ascending: false });

      setData(rows || []);
      setLoading(false);
    })();
  }, []);

  const counts: Record<string, number> = { pending: 0, replied: 0, archived: 0, followup: 0, skipped: 0 };
  for (const t of data) {
    const d = Array.isArray(t.decisions) ? t.decisions[0] : t.decisions;
    const s = d?.status || 'pending';
    counts[s] = (counts[s] || 0) + 1;
  }

  function downloadCSV() {
    const rows = data.map(t => {
      const d = Array.isArray(t.decisions) ? t.decisions[0] : t.decisions;
      return {
        thread_id: t.external_id,
        participants: (t.participants || []).join('; '),
        title: t.title,
        last_message_at: t.last_message_at,
        message_count: t.message_count,
        category: d?.category || '',
        status: d?.status || 'pending',
        summary: d?.summary || '',
        draft_reply: d?.draft_reply || d?.suggested_reply || '',
        notes: d?.notes || '',
        preview: t.preview,
      };
    });
    const Papa = require('papaparse');
    const csv = Papa.unparse(rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linkedin_triage_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyDrafts() {
    const text = data
      .map(t => {
        const d = Array.isArray(t.decisions) ? t.decisions[0] : t.decisions;
        if (!d || !d.draft_reply || d.status === 'archived' || d.status === 'skipped') return null;
        return `--- TO: ${(t.participants || []).join(', ')} (${d.category || 'Other'}) ---\n${d.draft_reply}`;
      })
      .filter(Boolean)
      .join('\n\n');
    navigator.clipboard?.writeText(text);
    alert('Copied all drafts to clipboard.');
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-2xl mx-auto px-7 py-12 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
          Step 03 — Export
        </div>
        <h1 className="serif text-5xl font-normal italic leading-tight tracking-tight mb-8">
          Your inbox, concluded.
        </h1>

        {loading ? (
          <div className="text-[var(--ink-3)] mono text-[12px]">Loading…</div>
        ) : (
          <>
            <div className="grid grid-cols-5 gap-2 mb-8">
              {STATUSES.map(s => (
                <div
                  key={s.id}
                  className="p-3 bg-[var(--paper-2)] rounded-lg border-l-[3px]"
                  style={{ borderLeftColor: s.color }}
                >
                  <div className="mono text-[9px] uppercase tracking-[0.15em] text-[var(--ink-3)]">
                    {s.label}
                  </div>
                  <div className="serif text-[22px]">{counts[s.id] || 0}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2 max-w-md">
              <button
                onClick={downloadCSV}
                className="w-full px-5 py-3 bg-[var(--ink)] text-[var(--paper)] rounded-full text-[13px] font-medium"
              >
                Download CSV
              </button>
              <button
                onClick={copyDrafts}
                className="w-full px-5 py-3 border border-[var(--rule-2)] rounded-full text-[13px] text-[var(--ink-2)]"
              >
                Copy all draft replies
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
