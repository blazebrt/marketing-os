'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { recordGoogleCampaignId } from './actions';
import { ownerMessage } from '@/lib/errorMessages';

export function RecordCampaignId({
  campaignId,
  existingId,
  isLive,
}: {
  campaignId: string;
  existingId: string | null;
  isLive: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(existingId || '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await recordGoogleCampaignId(campaignId, value);
      if (!result.ok) {
        setError(
          result.code === 'VALIDATION_FAILED'
            ? "That does not look like a Google campaign ID. It is a number, usually 10 or 11 digits, with no letters."
            : ownerMessage(result.code)
        );
        return;
      }
      setValue(result.googleCampaignId);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <section className={`rounded-lg border p-5 shadow-sm ${isLive ? 'border-green-200 bg-green-50' : 'border-blue-200 bg-blue-50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">
          {isLive ? 'This campaign is live' : 'Once you have created it in Google'}
        </h3>
        {isLive && (
          <span className="flex items-center gap-1 rounded-full bg-green-200 px-2 py-0.5 text-xs font-medium text-green-900">
            <CheckCircle2 className="h-3 w-3" /> LIVE
          </span>
        )}
      </div>

      <p className="mt-1 max-w-prose text-sm">
        {isLive
          ? 'Performance for this campaign is being collected each night. If you entered the wrong ID, correct it below.'
          : 'Paste the campaign ID Google gave you. In Google Ads Manager it is the "Campaign ID" column, or the number after campaignId= in the address bar.'}
      </p>

      <form onSubmit={submit} className="mt-4 flex flex-wrap items-start gap-2">
        <div>
          <label htmlFor="google-campaign-id" className="sr-only">Google campaign ID</label>
          <input
            id="google-campaign-id"
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="e.g. 22105538761"
            className="w-56 rounded-md border border-border bg-white px-3 py-2 font-mono text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending || value.trim() === ''}
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : isLive ? 'Update ID' : 'Mark as live'}
        </button>
      </form>

      {error && <p className="mt-3 max-w-prose text-sm text-red-700">{error}</p>}
      {saved && !error && (
        <p className="mt-3 text-sm text-green-800">
          Saved. Tonight&apos;s refresh will start collecting this campaign&apos;s performance.
        </p>
      )}
    </section>
  );
}
