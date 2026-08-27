'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { generateCreativesAction } from '@/app/campaigns/actions';
import { ownerMessage } from '@/lib/errorMessages';

export function GenerateCreativesButton({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await generateCreativesAction(campaignId);
            if (!result.ok) {
              setError(ownerMessage(result.code));
              return;
            }
            router.push(`/campaigns/${campaignId}/google`);
            router.refresh();
          });
        }}
        className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium disabled:opacity-50"
      >
        {pending ? 'Writing ads…' : 'Generate AI Creatives'}
      </button>
      {error && (
        <p className="max-w-prose rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
