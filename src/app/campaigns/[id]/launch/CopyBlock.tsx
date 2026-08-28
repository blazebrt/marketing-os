'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A block of setup values with a copy button. Falls back to selecting the text
 * when the clipboard is unavailable (older browsers, or a page not on HTTPS).
 */
export function CopyBlock({
  title,
  hint,
  value,
  lines,
  count,
}: {
  title: string;
  hint?: string;
  /** What actually gets copied. */
  value: string;
  /** What is shown. Falls back to the copied value. */
  lines?: string[];
  count?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);

  const copy = async () => {
    setFailed(false);
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  };

  const shown = lines && lines.length > 0 ? lines : [value];

  return (
    <section className="rounded-lg border bg-white shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <h3 className="font-semibold">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {count && <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:inline">{count}</span>}
          <button
            type="button"
            onClick={copy}
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </header>

      <div className="px-5 py-4">
        {shown.length === 1 ? (
          <p className="font-mono text-sm break-words select-all">{shown[0]}</p>
        ) : (
          <ol className="grid gap-1.5 sm:grid-cols-2">
            {shown.map((line, i) => (
              <li key={`${line}-${i}`} className="flex gap-2 font-mono text-sm">
                <span className="w-5 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}</span>
                <span className="break-words select-all">{line}</span>
              </li>
            ))}
          </ol>
        )}
        {failed && (
          <p className="mt-3 text-xs text-amber-700">
            Your browser blocked the copy button. Select the text above and copy it manually.
          </p>
        )}
      </div>
    </section>
  );
}
