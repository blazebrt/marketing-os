import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// Mocked server actions for Milestone 2
async function connectProvider(provider: string) {
  'use server'
  console.log(`Connecting ${provider}...`);
}

async function testConnection(provider: string) {
  'use server'
  console.log(`Testing ${provider}...`);
}

export default function IntegrationsPage() {
  const integrations = [
    { name: 'Meta Ads', provider: 'meta', status: 'disconnected', lastVerified: null },
    { name: 'Google Ads', provider: 'google', status: 'disconnected', lastVerified: null },
    { name: 'Website', provider: 'website', status: 'connected', lastVerified: '2 mins ago' },
  ];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">Integrations</h1>
      
      <div className="grid gap-6">
        {integrations.map((integration) => (
          <Card key={integration.provider}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div className="space-y-1">
                <CardTitle>{integration.name}</CardTitle>
                <CardDescription>
                  Status: 
                  <span className={`ml-2 font-semibold ${
                    integration.status === 'connected' ? 'text-green-600' : 'text-gray-500'
                  }`}>
                    {integration.status.toUpperCase()}
                  </span>
                </CardDescription>
              </div>
              <div>
                {integration.status === 'disconnected' ? (
                  <form action={connectProvider.bind(null, integration.provider)}>
                    <Button type="submit">Connect</Button>
                  </form>
                ) : (
                  <div className="flex gap-2">
                    <form action={testConnection.bind(null, integration.provider)}>
                      <Button variant="outline" type="submit">Test Connection</Button>
                    </form>
                    <form action={connectProvider.bind(null, integration.provider)}>
                      <Button variant="destructive" type="submit">Disconnect</Button>
                    </form>
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {integration.lastVerified && (
                <p className="text-sm text-gray-500">Last verified: {integration.lastVerified}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
