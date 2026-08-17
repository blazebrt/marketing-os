import { NextResponse } from 'next/server';
import { processIncomingLead } from '@/lib/deduplication';
import { withIdempotency } from '@/lib/idempotency';
import { verifyMetaSignature } from '@/lib/webhooks/verify';

export async function POST(req: Request) {
  try {
    // 1. Signature Verification (Example for Meta)
    const signature = req.headers.get('x-hub-signature-256');
    const rawBody = await req.text();
    
    // In production, fetch this from the database or env
    const metaAppSecret = process.env.META_APP_SECRET || 'test_secret';
    
    // For this milestone, we'll optionally verify if a signature is provided
    if (signature && !verifyMetaSignature(signature, rawBody, metaAppSecret)) {
      return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 401 });
    }

    const body = JSON.parse(rawBody);

    // 2. Validate basic input
    if (!body.name && !body.phone && !body.email) {
      return NextResponse.json({ error: 'Missing contact information' }, { status: 400 });
    }

    // 3. Idempotency Key (e.g., from external Lead ID or a hash of the payload)
    const idempotencyKey = body.external_lead_id || 
      `lead-${Buffer.from(rawBody).toString('base64').substring(0, 32)}`;

    // 4. Process Lead securely via server-side deduplication
    const result = await withIdempotency(
      idempotencyKey,
      'webhook',
      '/api/leads',
      async () => {
        return await processIncomingLead(body);
      }
    );

    return NextResponse.json(result);
  } catch (err: any) {
    if (err.message === 'Operation is already in progress.') {
      return NextResponse.json({ error: 'Too Many Requests' }, { status: 429 });
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
