'use client';

import { useState, useTransition } from 'react';
import { provisionWebsiteTracking } from './actions';
import { ownerMessage } from '@/lib/errorMessages';

export function WebsiteTracking({
  connected,
  integrationId,
}: {
  connected: boolean;
  integrationId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const connect = () => {
    setError(null);
    startTransition(async () => {
      const result = await provisionWebsiteTracking();
      if (!result.ok) {
        setError(ownerMessage(result.code));
        return;
      }
      setSecret(result.hmacSecret);
      setShownId(result.integrationId);
    });
  };

  const id = shownId || integrationId;

  return (
    <div className="flex flex-col items-end gap-3">
      <div className="flex items-center gap-4">
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
          connected ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
        }`}>
          {connected ? 'CONNECTED' : 'DISCONNECTED'}
        </span>
        {connected ? (
          <form action="/api/integrations/disconnect" method="POST">
            <input type="hidden" name="provider" value="website" />
            <button type="submit" className="px-4 py-2 bg-red-50 text-red-600 rounded-md text-sm font-medium hover:bg-red-100">
              Disconnect
            </button>
          </form>
        ) : null}
        <button
          type="button"
          onClick={connect}
          disabled={pending}
          className="px-4 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {connected ? 'Rotate secret' : 'Connect'}
        </button>
      </div>

      {id && (
        <p className="max-w-md text-right text-xs text-gray-600">
          Integration ID (send as <code>x-integration-id</code>):
          {' '}
          <code className="break-all font-mono">{id}</code>
        </p>
      )}

      {secret && (
        <div className="max-w-md rounded-md border border-amber-200 bg-amber-50 p-3 text-left text-xs text-amber-950">
          <p className="font-medium">HMAC secret — copy it now. It is not shown again.</p>
          <code className="mt-2 block break-all font-mono">{secret}</code>
          <p className="mt-2 text-amber-900">
            Sign each request as hex HMAC-SHA256 of <code>timestamp.rawBody</code> using this
            secret. Send that as <code>x-signature</code> and the timestamp as <code>x-timestamp</code>
            to <code>/api/interactions</code> and <code>/api/leads</code>.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
