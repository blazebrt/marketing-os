import { NextRequest, NextResponse } from 'next/server';
import { generateAndSaveGoogleCreatives } from '@/lib/providers/google/generative';
import { AppError, toSafeError, logSafeError, ERROR_CODES } from '@/lib/errors';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/ids';
import { mutationOriginAllowed } from '@/lib/http/mutationOrigin';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!mutationOriginAllowed(req)) {
      return NextResponse.json({ error: ERROR_CODES.UNAUTHORIZED, code: ERROR_CODES.UNAUTHORIZED }, { status: 403 });
    }

    const resolvedParams = await params;
    const campaignId = resolvedParams.id;

    if (!isUuid(campaignId)) {
      return NextResponse.json({ error: ERROR_CODES.VALIDATION_FAILED, code: ERROR_CODES.VALIDATION_FAILED }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: ERROR_CODES.UNAUTHORIZED, code: ERROR_CODES.UNAUTHORIZED }, { status: 401 });
    }

    const result = await generateAndSaveGoogleCreatives(campaignId);
    return NextResponse.json(result);
  } catch (error: unknown) {
    logSafeError('generate.route', error);
    const safe = error instanceof AppError
      ? { code: error.code, httpStatus: error.httpStatus }
      : toSafeError(error);
    return NextResponse.json({ error: safe.code, code: safe.code }, { status: safe.httpStatus });
  }
}
