'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Nav from '@/components/nav';

export default function ImportPage() {
  const [label, setLabel] = useState("My manager's account");
  const [ownerName, setOwnerName] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'classifying' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [unipileAvailable, setUnipileAvailable] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/unipile/connect');
      const j = await res.json();
      setUnipileAvailable(j.configured);
    })();
  }, []);

  async function handleFiles(files: FileList | null) {
    if (!files || !files[0]) return;
    const file = files[0];
    const text = await file.text();
    await ingestCsv(text);
  }

  async function ingestCsv(csvText: string) {
    setStatus('uploading');
    setMessage('Parsing and storing threads…');
    try {
      const res = await fetch('/api/ingest/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, ownerName, csv: csvText }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      const { account_id, thread_ids } = await res.json();
      setStatus('classifying');
      setMessage(`Classifying ${thread_ids.length} threads with Claude…`);
      setProgress({ done: 0, total: thread_ids.length });

      // Classify in chunks of 4 thread IDs at a time
      const BATCH = 4;
      for (let i = 0; i < thread_ids.length; i += BATCH) {
        const batch = thread_ids.slice(i, i + BATCH);
        await fetch('/api/classify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ thread_ids: batch }),
        });
        setProgress({ done: Math.min(i + BATCH, thread_ids.length), total: thread_ids.length });
      }

      setStatus('done');
      setMessage(`Imported and classified ${thread_ids.length} threads.`);
      setTimeout(() => router.push('/triage'), 800);
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message || String(e));
    }
  }

  async function connectUnipile() {
    setStatus('uploading');
    setMessage('Generating LinkedIn login link…');
    try {
      const res = await fetch('/api/unipile/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { url } = await res.json();
      window.location.href = url;
    } catch (e: any) {
      setStatus('error');
      setMessage(e.message);
    }
  }

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[820px] mx-auto px-7 py-12 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">
          Backup · CSV import
        </div>
        <h1 className="serif text-[48px] font-normal leading-[1.08] tracking-tight mb-3">
          Manual fallback.
        </h1>
        <p className="text-[var(--ink-2)] text-[15px] leading-relaxed mb-6 max-w-xl">
          The <strong>Chrome extension is the primary way</strong> data flows in — install it, browse LinkedIn normally,
          everything indexes automatically into the same unified database.
        </p>
        <div className="bg-[var(--paper-2)] border-l-[3px] border-[var(--accent)] rounded-lg p-4 mb-10 max-w-xl">
          <div className="mono text-[10px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-1.5">
            When to use this page
          </div>
          <p className="text-[13px] text-[var(--ink-2)] leading-relaxed">
            Use CSV import only if (1) the extension can't be installed, (2) you want to seed historical messages
            beyond what's currently in his inbox, or (3) Unipile auto-sync is configured. Otherwise: close this tab,
            install the extension, and let it run.
          </p>
          <Link href="/" className="inline-block mt-2 text-[12px] underline">← Back to Overview</Link>
        </div>

        <div className="mb-8">
          <label className="mono text-[9px] uppercase tracking-[0.22em] text-[var(--ink-3)] block mb-2">
            Account label
          </label>
          <input
            type="text"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="My manager's account"
            className="w-full max-w-md px-4 py-2.5 bg-[var(--paper-2)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
          />
        </div>

        {/* CSV PATH */}
        <section className="mb-8 p-7 bg-[var(--paper-2)] rounded-2xl">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="serif text-2xl font-normal italic">CSV upload</h2>
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-3)]">Fallback only</span>
          </div>
          <p className="text-[var(--ink-2)] text-[13px] mb-5">
            Get the export from{' '}
            <em>LinkedIn → Settings → Data Privacy → Get a copy of your data → Messages only</em>.
            Arrives by email in 10–30 min.
          </p>

          <div className="mb-4">
            <label className="mono text-[9px] uppercase tracking-[0.18em] text-[var(--ink-3)] block mb-2">
              Your manager's full name on LinkedIn (so we mark his replies as outbound)
            </label>
            <input
              type="text"
              value={ownerName}
              onChange={e => setOwnerName(e.target.value)}
              placeholder="Firstname Lastname"
              className="w-full max-w-md px-4 py-2.5 bg-[var(--paper)] border border-[var(--rule)] rounded-lg text-[14px] outline-none focus:border-[var(--ink-3)]"
            />
          </div>

          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className={`border border-dashed rounded-xl p-9 text-center cursor-pointer transition-colors ${
              dragging ? 'border-[var(--ink)] bg-[var(--paper-3)]' : 'border-[var(--rule-2)] bg-[var(--paper)]'
            }`}
          >
            <div className="serif text-xl font-normal mb-1">
              Drop <em>messages.csv</em> here
            </div>
            <div className="text-[12px] text-[var(--ink-3)]">or click to choose a file</div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={e => handleFiles(e.target.files)}
              className="hidden"
            />
          </div>
        </section>

        {/* UNIPILE PATH */}
        <section className="mb-8 p-7 bg-[var(--paper-2)] rounded-2xl">
          <div className="flex items-baseline justify-between mb-1">
            <h2 className="serif text-2xl font-normal italic">Unipile live sync</h2>
            <span className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--gold)]">$59+/mo</span>
          </div>
          <p className="text-[var(--ink-2)] text-[13px] mb-5">
            Your manager logs into LinkedIn once through Unipile's hosted login.
            New messages keep flowing in. Requires a Unipile subscription and{' '}
            <code className="mono text-[12px]">UNIPILE_API_KEY</code> + <code className="mono text-[12px]">UNIPILE_DSN</code> in env.
          </p>
          {unipileAvailable ? (
            <button
              onClick={connectUnipile}
              className="px-5 py-2.5 bg-[var(--ink)] text-[var(--paper)] rounded-full text-[13px] font-medium"
            >
              Generate LinkedIn login link →
            </button>
          ) : (
            <div className="text-[12px] text-[var(--ink-3)]">
              Set Unipile env vars and restart the server to enable.
            </div>
          )}
        </section>

        {/* STATUS */}
        {status !== 'idle' && (
          <div
            className={`p-5 rounded-xl border-l-[3px] ${
              status === 'error'
                ? 'border-[var(--accent)] bg-[rgba(184,84,80,0.06)]'
                : 'border-[var(--ink-3)] bg-[var(--paper-2)]'
            }`}
          >
            <div className="mono text-[9px] uppercase tracking-[0.2em] text-[var(--ink-3)] mb-1">
              {status}
            </div>
            <div className="text-[14px] text-[var(--ink-2)]">{message}</div>
            {status === 'classifying' && progress.total > 0 && (
              <div className="mt-3">
                <div className="w-full h-1 bg-[var(--paper-3)] rounded overflow-hidden">
                  <div
                    className="h-full bg-[var(--ink)] transition-all"
                    style={{ width: `${(progress.done / progress.total) * 100}%` }}
                  />
                </div>
                <div className="mono text-[10px] text-[var(--ink-3)] mt-1">
                  {progress.done} / {progress.total}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
