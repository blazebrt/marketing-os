'use client';

import { useState } from 'react';
import { deployToTestAccount, reconcileDeployment } from './actions';
import { Loader2 } from 'lucide-react';

export function DeploymentPanel({ 
  campaignId, 
  status, 
  deploymentState 
}: { 
  campaignId: string; 
  status: string;
  deploymentState: any;
}) {
  const [isDeploying, setIsDeploying] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconciliationResult, setReconciliationResult] = useState<any>(null);

  const handleDeploy = async () => {
    setIsDeploying(true);
    setError(null);
    try {
      await deployToTestAccount(campaignId);
    } catch (err: any) {
      setError(err.message || 'Deployment failed');
    } finally {
      setIsDeploying(false);
    }
  };

  const handleReconcile = async () => {
    setIsReconciling(true);
    setError(null);
    try {
      const result = await reconcileDeployment(campaignId);
      setReconciliationResult(result);
    } catch (err: any) {
      setError(err.message || 'Reconciliation failed');
    } finally {
      setIsReconciling(false);
    }
  };

  const isReady = status === 'READY_TO_DEPLOY';
  const depStatus = deploymentState?.status || 'PENDING';
  const externalState = deploymentState?.external_state || {};
  
  if (!isReady && depStatus === 'PENDING') {
    return null;
  }

  return (
    <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
      <h2 className="text-xl font-semibold border-b pb-2">Deploy to Test Account</h2>
      
      {error && (
        <div className="text-red-600 bg-red-50 p-4 rounded border border-red-200">
          <strong>Error:</strong> {error}
        </div>
      )}

      {depStatus === 'PENDING' && isReady && (
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded border border-blue-200 text-sm text-blue-800 space-y-2">
            <p><strong>Safety Confirmation:</strong></p>
            <ul className="list-disc pl-5">
              <li>Will deploy to configured Google Ads TEST account.</li>
              <li>No production spend will occur.</li>
              <li>Only owner-approved creatives will be deployed.</li>
              <li>Budget and strategy enforced by authoritative backend safety constraints.</li>
            </ul>
          </div>
          
          <button 
            onClick={handleDeploy} 
            disabled={isDeploying}
            className="bg-black text-white px-4 py-2 rounded font-medium flex items-center gap-2 hover:bg-gray-800 disabled:opacity-50"
          >
            {isDeploying && <Loader2 className="w-4 h-4 animate-spin" />}
            Deploy to Test Account
          </button>
        </div>
      )}

      {depStatus !== 'PENDING' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Deployment Status</p>
              <p className="font-medium">{depStatus}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Reconciliation</p>
              <p className="font-medium">{deploymentState?.reconciliation_status || 'UNKNOWN'}</p>
            </div>
          </div>

          {Object.keys(externalState).length > 0 && (
            <div className="bg-gray-50 p-4 rounded border text-sm overflow-auto">
              <p className="font-semibold mb-2">Google Ads Resources</p>
              <pre>{JSON.stringify(externalState, null, 2)}</pre>
            </div>
          )}

          <div className="pt-4 border-t">
            <button 
              onClick={handleReconcile} 
              disabled={isReconciling}
              className="bg-gray-100 text-gray-900 border border-gray-300 px-4 py-2 rounded font-medium flex items-center gap-2 hover:bg-gray-200 disabled:opacity-50"
            >
              {isReconciling && <Loader2 className="w-4 h-4 animate-spin" />}
              Reconcile External State
            </button>
            
            {reconciliationResult && (
              <div className="mt-4 p-4 rounded border bg-gray-50 text-sm">
                <p><strong>Status:</strong> {reconciliationResult.status}</p>
                {reconciliationResult.differences?.length > 0 && (
                  <ul className="list-disc pl-5 mt-2 text-red-600">
                    {reconciliationResult.differences.map((d: string, i: number) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
