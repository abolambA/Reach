'use client';

import { useState } from 'react';
import Nav from '@/components/nav';

const CAT_COLORS: Record<string, string> = {
  Sales: '#b45309',
  Recruiter: '#7c3aed',
  Job: '#0e7490',
  Network: '#15803d',
  Question: '#1d4ed8',
  Personal: '#be185d',
  Spam: '#6b7280',
  Other: '#525252',
};

const URGENCY_COLORS: Record<string, string> = {
  high: '#dc2626',
  medium: '#d97706',
  low: '#16a34a',
};

type Result = {
  category: string;
  summary: string;
  suggested_reply: string;
  urgency: string;
  worth_replying: boolean;
};

export default function PastePage() {
  const [mode, setMode] = useState<'single' | 'conversation'>('single');
  const [sender, setSender] = useState('');
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editedReply, setEditedReply] = useState('');

  async function analyze() {
    if (!text.trim()) {
      setError('Paste a message first.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/triage-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, sender: sender.trim() || undefined, text: text.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
      } else {
        setResult(data);
        setEditedReply(data.suggested_reply || '');
      }
    } catch (e: any) {
      setError(e.message || 'Request failed.');
    } finally {
      setLoading(false);
    }
  }

  function copyReply() {
    navigator.clipboard.writeText(editedReply);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  function reset() {
    setText('');
    setSender('');
    setResult(null);
    setError(null);
    setEditedReply('');
  }

  return (
    <div className="min-h-screen bg-[var(--paper)]">
      <Nav />
      <main className="max-w-[820px] mx-auto px-7 py-12">
        <p className="mono text-[11px] uppercase tracking-[0.18em] text-[var(--ink-3)] mb-2">
          Inbox · Paste &amp; triage
        </p>
        <h1 className="serif text-[44px] leading-[1.05] font-medium tracking-tight mb-3">
          Drop in a message.
        </h1>
        <p className="text-[var(--ink-2)] text-[15px] leading-relaxed mb-8 max-w-[560px]">
          Paste anything you received on LinkedIn. Reach reads it, tells you what it
          is, and drafts a reply in your voice using your style brief. Nothing is
          stored — this is a scratchpad.
        </p>

        {/* Mode toggle */}
        <div className="flex items-center gap-1 mb-5 p-1 rounded-full bg-[var(--paper-2)] w-fit">
          <button
            onClick={() => setMode('single')}
            className={`px-4 py-1.5 rounded-full text-[12px] mono uppercase tracking-[0.08em] transition-colors ${
              mode === 'single' ? 'bg-[var(--ink)] text-[var(--paper)]' : 'text-[var(--ink-2)]'
            }`}
          >
            Single message
          </button>
          <button
            onClick={() => setMode('conversation')}
            className={`px-4 py-1.5 rounded-full text-[12px] mono uppercase tracking-[0.08em] transition-colors ${
              mode === 'conversation' ? 'bg-[var(--ink)] text-[var(--paper)]' : 'text-[var(--ink-2)]'
            }`}
          >
            Whole conversation
          </button>
        </div>

        {/* Sender name (optional) */}
        <input
          value={sender}
          onChange={e => setSender(e.target.value)}
          placeholder="Sender name (optional) — e.g. Sheikh Shahzad"
          className="w-full mb-3 px-4 py-2.5 rounded-lg border border-[var(--rule)] bg-[var(--paper)] text-[14px] focus:outline-none focus:border-[var(--ink-3)]"
        />

        {/* Paste area */}
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={
            mode === 'single'
              ? 'Paste the message you received…'
              : 'Paste the whole conversation — include both sides if you have them…'
          }
          rows={mode === 'conversation' ? 12 : 6}
          className="w-full px-4 py-3 rounded-lg border border-[var(--rule)] bg-[var(--paper)] text-[14px] leading-relaxed resize-y focus:outline-none focus:border-[var(--ink-3)]"
        />

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={analyze}
            disabled={loading || !text.trim()}
            className="px-5 py-2.5 rounded-full bg-[var(--ink)] text-[var(--paper)] text-[13px] mono uppercase tracking-[0.08em] disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            {loading ? 'Reading…' : '✦ Analyze & draft reply'}
          </button>
          {(result || text) && (
            <button
              onClick={reset}
              className="px-4 py-2.5 rounded-full text-[13px] mono uppercase tracking-[0.08em] text-[var(--ink-2)] hover:bg-[var(--paper-2)] transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        {error && (
          <p className="mt-5 text-[14px] text-[#dc2626]">{error}</p>
        )}

        {/* Result */}
        {result && (
          <div className="mt-9 border-t border-[var(--rule)] pt-8">
            <div className="flex items-center gap-3 mb-5 flex-wrap">
              <span
                className="px-3 py-1 rounded-full text-[11px] mono uppercase tracking-[0.1em] text-white"
                style={{ backgroundColor: CAT_COLORS[result.category] || '#525252' }}
              >
                {result.category}
              </span>
              <span
                className="px-3 py-1 rounded-full text-[11px] mono uppercase tracking-[0.1em]"
                style={{
                  color: URGENCY_COLORS[result.urgency] || '#525252',
                  border: `1px solid ${URGENCY_COLORS[result.urgency] || '#525252'}`,
                }}
              >
                {result.urgency} urgency
              </span>
              {!result.worth_replying && (
                <span className="px-3 py-1 rounded-full text-[11px] mono uppercase tracking-[0.1em] text-[var(--ink-3)] border border-[var(--rule)]">
                  Probably skip
                </span>
              )}
            </div>

            <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-3)] mb-1.5">
              What this is
            </p>
            <p className="text-[15px] text-[var(--ink)] mb-7 leading-relaxed">
              {result.summary}
            </p>

            {result.worth_replying && (
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="mono text-[10px] uppercase tracking-[0.18em] text-[var(--ink-3)]">
                    Drafted reply — in your voice
                  </p>
                  <button
                    onClick={copyReply}
                    className="px-3 py-1 rounded-full text-[11px] mono uppercase tracking-[0.08em] bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 transition-opacity"
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <textarea
                  value={editedReply}
                  onChange={e => setEditedReply(e.target.value)}
                  rows={5}
                  className="w-full px-4 py-3 rounded-lg border border-[var(--rule)] bg-[var(--paper-2)] text-[14px] leading-relaxed resize-y focus:outline-none focus:border-[var(--ink-3)]"
                />
                <p className="mt-2 text-[12px] text-[var(--ink-3)]">
                  Edit freely, then copy and paste into LinkedIn. The more you add at{' '}
                  <a href="/style" className="underline">Style</a>, the more this sounds like you.
                </p>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
