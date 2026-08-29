import http from 'node:http';

/**
 * A local stand-in for the Gemini endpoint.
 *
 * The creative generator calls a real model and deliberately has no template
 * fallback, so tests that exercise generation need something to answer. This
 * serves well-formed ad copy and points the SDK at itself via GEMINI_BASE_URL.
 */
export type StubGeminiOptions = {
  /**
   * Chooses what to serve for a given request. Return the object the model
   * should have produced, or null to fall through to the default ad copy.
   * Lets one stub answer both strategy and creative calls in the same test.
   */
  respond?: (requestBody: string, callIndex: number) => unknown | null;
};

export type StubGemini = {
  port: number;
  /** Number of generate calls received so far. */
  callCount: () => number;
  /** Bodies of the requests received, for asserting what was sent. */
  requests: () => string[];
  /** Make the next call fail, to test the no-fallback path. */
  failNext: (status?: number) => void;
  close: () => Promise<void>;
};

function adCopy(seed: number) {
  const uniq = (i: number) => `${seed}${i}`;
  return {
    headlines: Array.from({ length: 15 }, (_, i) => `Bridal Makeup Deal ${uniq(i)}`),
    descriptions: Array.from({ length: 4 }, (_, i) => `Expert bridal makeup near you, book your slot today ${uniq(i)}`),
    keywords: Array.from({ length: 20 }, (_, i) => ({
      text: `bridal makeup lucknow ${uniq(i)}`,
      match_type: i % 3 === 0 ? 'EXACT' : 'PHRASE',
    })),
  };
}

export async function startStubGemini(options: StubGeminiOptions = {}): Promise<StubGemini> {
  let calls = 0;
  let failStatus: number | null = null;
  const bodies: string[] = [];

  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    bodies.push(body);
    calls += 1;

    if (failStatus !== null) {
      const status = failStatus;
      failStatus = null;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'stub failure' } }));
      return;
    }

    const custom = options.respond ? options.respond(body, calls) : null;
    const payload = custom === null || custom === undefined ? adCopy(calls) : custom;

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        candidates: [
          { content: { parts: [{ text: JSON.stringify(payload) }], role: 'model' }, finishReason: 'STOP' },
        ],
      })
    );
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as { port: number }).port;

  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key';
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}`;

  return {
    port,
    callCount: () => calls,
    requests: () => bodies,
    failNext: (status = 500) => { failStatus = status; },
    close: () =>
      new Promise<void>((resolve) => {
        delete process.env.GEMINI_BASE_URL;
        server.close(() => resolve());
      }),
  };
}
