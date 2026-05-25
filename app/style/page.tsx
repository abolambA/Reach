'use client';

import { useEffect, useState } from 'react';
import Nav from '@/components/nav';

export default function StylePage() {
  const [brief, setBrief] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [embedding, setEmbedding] = useState(false);
  const [embedResult, setEmbedResult] = useState<string | null>(null);
  const [corpusCount, setCorpusCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const [b, c] = await Promise.all([
        fetch('/api/style-brief').then(r => r.json()),
        fetch('/api/corpus-stats').then(r => r.json()).catch(() => ({ count: null })),
      ]);
      setBrief(b.content || '');
      setCorpusCount(c.count);
      setLoading(false);
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    await fetch('/api/style-brief', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: brief }),
    });
    setSaving(false);
  };

  const embedCorpus = async () => {
    setEmbedding(true);
    setEmbedResult(null);
    const res = await fetch('/api/embed-corpus', { method: 'POST' });
    const j = await res.json();
    setEmbedding(false);
    setEmbedResult(j.embedded !== undefined ? `Embedded ${j.embedded} new items.` : j.error || 'failed');
    // refresh count
    const c = await fetch('/api/corpus-stats').then(r => r.json()).catch(() => ({ count: null }));
    setCorpusCount(c.count);
  };

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="max-w-[820px] mx-auto px-7 py-10 fade-in">
        <div className="mono text-[10px] uppercase tracking-[0.22em] text-[var(--ink-3)] mb-3">Style</div>
        <h1 className="serif text-[40px] italic font-normal leading-tight mb-3">Sound like yourself.</h1>
        <p className="text-[var(--ink-2)] text-[14px] mb-7 max-w-xl">
          Every draft Reach writes is RAG-augmented from your actual writing. The corpus is your
          past sent messages and posts. The brief is freeform notes you write to nudge the model.
        </p>

        <section className="bg-[var(--paper-2)] rounded-2xl p-5 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <div className="serif text-[20px] italic">Corpus</div>
            <div className="mono text-[10px] uppercase tracking-[0.15em] text-[var(--ink-3)]">
              {corpusCount === null ? '…' : `${corpusCount.toLocaleString()} chunks embedded`}
            </div>
          </div>
          <p className="text-[13px] text-[var(--ink-2)] mb-3">
            Embeds your sent messages and self-authored posts so drafts can retrieve your tone.
            Safe to run repeatedly — only embeds new items.
          </p>
          <button
            onClick={embedCorpus}
            disabled={embedding}
            className="px-4 py-2 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px] font-medium disabled:opacity-40"
          >
            {embedding ? 'Embedding…' : 'Embed new items'}
          </button>
          {embedResult && (
            <div className="mt-3 mono text-[11px] text-[var(--ink-3)]">{embedResult}</div>
          )}
        </section>

        <section className="bg-[var(--paper-2)] rounded-2xl p-5">
          <div className="serif text-[20px] italic mb-3">Style brief</div>
          <p className="text-[13px] text-[var(--ink-2)] mb-3">
            Freeform notes about how you write — things the corpus can't teach. e.g.{' '}
            <em>"warm but direct; never use exclamation marks; sign off with —Salim"</em>
          </p>
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            rows={10}
            placeholder="I'm warm and direct. I usually open with a specific reference to their work, not a generic 'Hope this finds you well.' Sentences are short. I sign off with just my first name."
            className="w-full p-3 text-[14px] leading-relaxed border border-[var(--rule)] rounded-lg bg-[var(--paper)] outline-none focus:border-[var(--ink-3)] resize-none mb-3"
          />
          <button
            onClick={save}
            disabled={saving || loading}
            className="px-4 py-2 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[12px] font-medium disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save brief'}
          </button>
        </section>
      </main>
    </div>
  );
}
