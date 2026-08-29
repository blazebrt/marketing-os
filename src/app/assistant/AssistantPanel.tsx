'use client';

import { useState, useTransition } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { ownerMessage } from '@/lib/errorMessages';
import { askAssistant } from './actions';
import type { AssistantAnswer } from '@/lib/assistant/answer';

const SUGGESTIONS = [
  'How is my marketing doing?',
  'Which service should I promote?',
  'Why is my cost per customer high?',
  'What should I do this week?',
];

export function AssistantPanel() {
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ask = (text: string) => {
    if (text.trim().length < 3) return;
    setError(null);
    setAnswer(null);
    setAsked(text);
    startTransition(async () => {
      const result = await askAssistant(text);
      if (!result.ok) { setError(ownerMessage(result.code)); return; }
      setAnswer(result.answer);
    });
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => { e.preventDefault(); ask(question); }}
        className="rounded-lg border bg-white p-5 shadow-sm"
      >
        <label htmlFor="assistant-question" className="text-sm font-medium">
          Ask about your marketing
        </label>
        <div className="mt-2 flex gap-2">
          <input
            id="assistant-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="How is my marketing doing?"
            className="flex-1 rounded-md border border-border px-3 py-2 text-sm"
          />
          <button type="submit" disabled={pending || question.trim().length < 3}
            className="flex items-center gap-1.5 rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            <Send className="h-4 w-4" /> {pending ? 'Thinking…' : 'Ask'}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => { setQuestion(s); ask(s); }} disabled={pending}
              className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50">
              {s}
            </button>
          ))}
        </div>
      </form>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
      )}

      {asked && answer && (
        <article className="rounded-lg border bg-white p-5 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageCircle className="h-3.5 w-3.5" /> {asked}
          </p>

          <p className="mt-3 whitespace-pre-line text-sm">{answer.answer}</p>

          {answer.insufficient_data && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              There is not enough data to answer this properly yet. Rather than estimate, Marketing
              OS is telling you what is missing.
            </p>
          )}

          {answer.figures_used.length > 0 && (
            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-slate-50 px-4 py-3 text-sm">
              {answer.figures_used.map((f) => (
                <div key={f.label} className="flex gap-1.5">
                  <dt className="text-muted-foreground">{f.label}:</dt>
                  <dd className="font-medium tabular-nums">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {answer.suggested_next_step && (
            <p className="mt-3 text-sm">
              <span className="font-medium">Suggested next step: </span>
              <span className="text-muted-foreground">{answer.suggested_next_step}</span>
            </p>
          )}
        </article>
      )}
    </div>
  );
}
