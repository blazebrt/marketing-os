'use client';

import { useState, useTransition } from 'react';
import { Bot, CheckCircle, XCircle, Edit2, Check, X } from 'lucide-react';
import { GoogleCreativeItem } from '@/lib/providers/google/types';
import { updateGoogleCreativeItem } from './actions';

export function CreativeItemRow({ 
  campaignId, 
  creativeId, 
  itemType, 
  item 
}: { 
  campaignId: string, 
  creativeId: string, 
  itemType: 'headlines' | 'descriptions' | 'keywords', 
  item: GoogleCreativeItem 
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.current_value);
  const [isPending, startTransition] = useTransition();

  const handleAction = (action: 'approve' | 'reject' | 'edit') => {
    startTransition(async () => {
      try {
        await updateGoogleCreativeItem(campaignId, creativeId, itemType, item.id, action, action === 'edit' ? editValue : undefined);
        setIsEditing(false);
      } catch (e: any) {
        alert(e.message);
      }
    });
  };

  return (
    <div className={`flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 rounded border ${item.rejected ? 'bg-red-50 border-red-100' : 'bg-slate-50'}`}>
      <div className="flex-1 min-w-0 pr-4">
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input 
              type="text" 
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              className="flex-1 px-2 py-1 text-sm border rounded"
              autoFocus
            />
            <button onClick={() => handleAction('edit')} disabled={isPending} className="p-1 text-green-600 hover:bg-green-50 rounded">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => { setIsEditing(false); setEditValue(item.current_value); }} disabled={isPending} className="p-1 text-slate-500 hover:bg-slate-200 rounded">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className={`font-medium ${item.rejected ? 'text-red-800 line-through' : ''}`}>{item.current_value}</span>
            {item.ai_generated && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full flex items-center gap-1">
                <Bot className="w-3 h-3" /> AI
              </span>
            )}
            {item.match_type && (
              <span className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded-full">
                {item.match_type}
              </span>
            )}
            {item.current_value !== item.original_value && (
              <span className="text-xs text-slate-500 italic block mt-1 w-full">
                Original: {item.original_value}
              </span>
            )}
          </div>
        )}
      </div>

      {!isEditing && (
        <div className="flex items-center gap-2 mt-3 sm:mt-0">
          {item.owner_approved ? (
            <span className="flex items-center gap-1 text-sm text-green-600 font-medium px-2 py-1">
              <CheckCircle className="w-4 h-4" /> Approved
            </span>
          ) : item.rejected ? (
            <span className="flex items-center gap-1 text-sm text-red-600 font-medium px-2 py-1">
              <XCircle className="w-4 h-4" /> Rejected
            </span>
          ) : (
            <>
              <button 
                onClick={() => handleAction('approve')} 
                disabled={isPending}
                className="px-3 py-1 text-xs font-medium bg-green-100 text-green-700 rounded hover:bg-green-200 disabled:opacity-50"
              >
                Approve
              </button>
              <button 
                onClick={() => handleAction('reject')} 
                disabled={isPending}
                className="px-3 py-1 text-xs font-medium bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
              >
                Reject
              </button>
              <button 
                onClick={() => setIsEditing(true)} 
                disabled={isPending}
                className="px-3 py-1 text-xs font-medium bg-slate-200 text-slate-700 rounded hover:bg-slate-300 disabled:opacity-50 flex items-center gap-1"
              >
                <Edit2 className="w-3 h-3" /> Edit
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
