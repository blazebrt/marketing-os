'use client';

import { useState, useTransition } from 'react';
import { verifyDestinationAction, requestApproval, approveCampaign } from '@/app/campaigns/actions';

export function VerificationPanel({
  campaignId,
  status,
  checks,
  allPass,
}: {
  campaignId: string;
  status: string;
  checks: { name: string; pass: boolean; message: string }[];
  allPass: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [localChecks, setLocalChecks] = useState(checks);
  const [passed, setPassed] = useState(allPass);

  return (
    <div className="mb-8 border p-6 rounded-lg bg-white shadow-sm">
      <h2 className="text-xl font-bold mb-4">Pre-launch Verification</h2>
      <ul className="space-y-2 mb-6">
        {localChecks.map((c, i) => (
          <li key={i} className="flex items-center">
            <span className={`mr-2 font-bold ${c.pass ? 'text-green-600' : 'text-red-600'}`}>
              {c.pass ? '✓' : '✗'}
            </span>
            <span>{c.name}: <span className="text-gray-600 text-sm">{c.message}</span></span>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await verifyDestinationAction(campaignId);
              setLocalChecks(result.checks || []);
              setPassed(!!result.ok);
              if (!result.ok && result.code) setError(result.code);
            });
          }}
          className="bg-slate-800 text-white px-4 py-2 rounded"
        >
          {pending ? 'Checking…' : 'Verify destination & eligibility'}
        </button>

        {passed && status === 'DRAFT' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await requestApproval(campaignId);
                } catch {
                  setError('APPROVAL_FAILED');
                }
              });
            }}
            className="bg-black text-white px-6 py-3 rounded-lg font-medium"
          >
            Submit for Approval
          </button>
        )}

        {passed && status === 'PENDING_APPROVAL' && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              startTransition(async () => {
                try {
                  await approveCampaign(campaignId);
                } catch {
                  setError('APPROVAL_FAILED');
                }
              });
            }}
            className="bg-green-600 text-white px-6 py-3 rounded-lg font-medium"
          >
            Approve Campaign
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-700 mt-3">{error}</p>}
    </div>
  );
}
