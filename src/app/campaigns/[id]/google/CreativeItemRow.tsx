'use client';

import { useState, useTransition } from 'react';
import { Bot, CheckCircle, XCircle, Edit2, Check, X, RefreshCw, Undo2 } from 'lucide-react';
import { GoogleCreativeItem } from '@/lib/providers/google/types';
import { GOOGLE_LIMITS } from '@/lib/providers/google/validation';
import { ownerMessage } from '@/lib/errorMessages';
import { updateGoogleCreativeItem, regenerateGoogleCreativeItem } from './actions';

const LIMITS: Record<string, number> = {
  headlines: GOOGLE_LIMITS.HEADLINE_MAX_LENGTH,
  descriptions: GOOGLE_LIMITS.DESCRIPTION_MAX_LENGTH,
  keywords: GOOGLE_LIMITS.KEYWORD_MAX_LENGTH,
};

export function CreativeItemRow({
  campaignId,
  creativeId,
  itemType,
  item,
}: {
  campaignId: string;
  creativeId: string;
  itemType: 'headlines' | 'descriptions' | 'keywords';
  item: GoogleCreativeItem;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.current_value);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const limit = LIMITS[itemType];
  const overLimit = editValue.length > limit;
  const pendingDecision = item.owner_approved !== true && !item.rejected;

  const run = (fn: () => Promise<unknown>) => {
    startTransition(async () => {
      setError(null);
      try {
        await fn();
        setIsEditing(false);
      } catch (e) {
        const code = e instanceof Error ? e.message : undefined;
        setError(ownerMessage(code));
      }
    });
  };

  const handleAction = (action: 'approve' | 'reject' | 'edit' | 'regenerate' | 'replace') =>
    run(() =>
      updateGoogleCreativeItem(
        campaignId,
        creativeId,
        itemType,
        item.id,
        action,
        action === 'edit' || action === 'replace' ? editValue : undefined
      )
    );

  const handleRegenerate = () =>
    run(async () => {
      const result = await regenerateGoogleCreativeItem(campaignId, itemType, item.id);
      if (!result.ok) throw new Error(result.code);
    });

  const border = item.rejected
    ? 'bg-red-50 border-red-200'
    : item.owner_approved === true
      ? 'bg-green-50 border-green-200'
      : 'bg-amber-50 border-amber-200';

  return (
    <div className={`flex flex-col gap-3 rounded border p-3 sm:flex-row sm:items-center sm:justify-between ${border}`}>
      <div className="min-w-0 flex-1 sm:pr-4">
        {isEditing ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className={`flex-1 rounded border px-2 py-1 text-sm ${overLimit ? 'border-red-500' : ''}`}
                autoFocus
              />
              <button
                onClick={() => handleAction(item.owner_approved ? 'replace' : 'edit')}
                disabled={isPending || overLimit || editValue.trim() === ''}
                title="Save"
                className="rounded p-1 text-green-700 hover:bg-green-100 disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => { setIsEditing(false); setEditValue(item.current_value); setError(null); }}
                disabled={isPending}
                title="Cancel"
                className="rounded p-1 text-slate-500 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <span className={`text-xs ${overLimit ? 'font-medium text-red-600' : 'text-slate-500'}`}>
              {editValue.length} / {limit} characters
              {overLimit ? ' — too long for a Google ad' : ''}
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${item.rejected ? 'text-red-800 line-through' : ''}`}>
              {item.current_value}
            </span>
            <span className="text-xs text-slate-500">{item.current_value.length}/{limit}</span>
            {item.ai_generated && (
              <span className="flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                <Bot className="h-3 w-3" /> AI
              </span>
            )}
            {item.match_type && (
              <span className="rounded-full bg-slate-200 px-2 py-1 text-xs text-slate-700">{item.match_type}</span>
            )}
            {item.current_value !== item.original_value && (
              <span className="mt-1 block w-full text-xs italic text-slate-500">
                Original: {item.original_value}
              </span>
            )}
          </div>
        )}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>

      {!isEditing && (
        <div className="flex flex-wrap items-center gap-2">
          {item.owner_approved === true ? (
            <>
              <span className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-green-700">
                <CheckCircle className="h-4 w-4" /> Approved
              </span>
              <button
                onClick={() => setIsEditing(true)}
                disabled={isPending}
                className="rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 disabled:opacity-50"
              >
                Replace (needs re-approval)
              </button>
            </>
          ) : item.rejected ? (
            <>
              <span className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-red-700">
                <XCircle className="h-4 w-4" /> Rejected
              </span>
              <button
                onClick={handleRegenerate}
                disabled={isPending}
                title="Ask the AI for new wording"
                className="flex items-center gap-1 rounded bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} />
                {isPending ? 'Writing…' : 'Regenerate'}
              </button>
              <button
                onClick={() => handleAction('regenerate')}
                disabled={isPending}
                title="Put back the original AI wording"
                className="flex items-center gap-1 rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
              >
                <Undo2 className="h-3 w-3" /> Restore
              </button>
            </>
          ) : (
            <>
              {pendingDecision && (
                <span className="rounded-full bg-amber-200 px-2 py-1 text-xs font-medium text-amber-900">
                  Awaiting decision
                </span>
              )}
              <button
                onClick={() => handleAction('approve')}
                disabled={isPending}
                className="rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-200 disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => handleAction('reject')}
                disabled={isPending}
                className="rounded bg-red-100 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-200 disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => setIsEditing(true)}
                disabled={isPending}
                className="flex items-center gap-1 rounded bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-300 disabled:opacity-50"
              >
                <Edit2 className="h-3 w-3" /> Edit
              </button>
              <button
                onClick={handleRegenerate}
                disabled={isPending}
                title="Ask the AI for new wording"
                className="flex items-center gap-1 rounded bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700 hover:bg-blue-200 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${isPending ? 'animate-spin' : ''}`} />
                {isPending ? 'Writing…' : 'Regenerate'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
