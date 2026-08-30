import './setup';
import { validateDestinationUrl, validateDestinationUrlSyntax, URL_VALIDATION } from '../src/lib/urlValidator';
import { classifyAddress } from '../src/lib/net/ip';

let pass = 0;
let fail = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`PASS: ${label}`);
    pass++;
  } else {
    console.error(`FAIL: ${label}`);
    fail++;
  }
}

function publicLookup(address = '93.184.216.34') {
  return async () => [{ address, family: 4 }];
}

function okFetch(status = 200, headers: Record<string, string> = {}) {
  return async () => new Response(null, { status, headers });
}

async function run() {
  console.log('--- M7 SSRF TESTS ---\n');

  assert(classifyAddress('127.0.0.1') === 'blocked', 'classify 127.0.0.1 blocked');
  assert(classifyAddress('10.1.2.3') === 'blocked', 'classify 10/8 blocked');
  assert(classifyAddress('172.16.0.1') === 'blocked', 'classify 172.16/12 blocked');
  assert(classifyAddress('172.31.255.1') === 'blocked', 'classify 172.31 blocked');
  assert(classifyAddress('172.32.0.1') === 'public', 'classify 172.32 public');
  assert(classifyAddress('192.168.1.1') === 'blocked', 'classify 192.168 blocked');
  assert(classifyAddress('169.254.169.254') === 'blocked', 'classify metadata IP blocked');
  assert(classifyAddress('100.64.0.1') === 'blocked', 'classify CGNAT blocked');
  assert(classifyAddress('0.0.0.0') === 'blocked', 'classify 0.0.0.0 blocked');
  assert(classifyAddress('8.8.8.8') === 'public', 'classify 8.8.8.8 public');
  assert(classifyAddress('::1') === 'blocked', 'classify ::1 blocked');
  assert(classifyAddress('fe80::1') === 'blocked', 'classify link-local blocked');
  assert(classifyAddress('fd12::2') === 'blocked', 'classify ULA blocked');
  assert(classifyAddress('::ffff:127.0.0.1') === 'blocked', 'classify IPv4-mapped loopback blocked');
  assert(classifyAddress('::ffff:169.254.169.254') === 'blocked', 'classify IPv4-mapped metadata blocked');
  assert(classifyAddress('::ffff:10.0.0.1') === 'blocked', 'classify IPv4-mapped 10/8 blocked');
  assert(classifyAddress('::127.0.0.1') === 'blocked', 'classify IPv4-compatible loopback blocked');
  assert(classifyAddress('::169.254.169.254') === 'blocked', 'classify IPv4-compatible metadata blocked');

  const blocked = [
    'https://localhost/',
    'https://127.0.0.1/',
    'https://10.0.0.1/',
    'https://172.16.1.1/',
    'https://192.168.0.5/',
    'https://169.254.169.254/latest/meta-data/',
    'https://metadata.google.internal/',
    'https://[::1]/',
    'https://[::ffff:127.0.0.1]/',
    'https://[::127.0.0.1]/',
    'https://[fd00::1]/',
    'https://[fe80::1]/',
    'https://100.64.1.1/',
    'ftp://example.com/',
    'http://example.com/',
    'https://user:pass@example.com/',
  ];

  for (const url of blocked) {
    const result = await validateDestinationUrl(url, {
      lookup: publicLookup(),
      fetchImpl: okFetch(),
    });
    assert(result.valid === false, `blocked ${url}`);
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: async () => [{ address: '10.0.0.1', family: 4 }],
      fetchImpl: okFetch(),
    });
    assert(result.valid === false, 'DNS hostname resolving private rejected');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.1', family: 4 },
      ],
      fetchImpl: okFetch(),
    });
    assert(result.valid === false, 'ambiguous mixed public+private DNS rejected');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: async () => {
        throw new Error('ENOTFOUND');
      },
      fetchImpl: okFetch(),
    });
    assert(result.valid === false, 'DNS failure rejected');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: publicLookup(),
      fetchImpl: async () =>
        new Response(null, { status: 302, headers: { Location: 'https://169.254.169.254/' } }),
    });
    assert(result.valid === false, 'public → private redirect rejected');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: publicLookup(),
      fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'http://example.com/' } }),
    });
    assert(result.valid === false, 'HTTPS → HTTP redirect rejected');
  }

  {
    let hops = 0;
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: publicLookup(),
      fetchImpl: async () => {
        hops += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: `https://example.com/h${hops}` },
        });
      },
    });
    assert(result.valid === false, 'redirect chain over limit rejected');
    assert(hops === URL_VALIDATION.MAX_REDIRECTS + 1, 'redirect limit enforced');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: publicLookup(),
      fetchImpl: async (_url, init) => {
        assert(init.method === 'HEAD', 'request method pinned to HEAD');
        assert(init.redirect === 'manual', 'redirects are manual');
        assert(!Object.keys(init.headers as any).some((k) => /authorization|cookie/i.test(k)), 'no auth/cookie headers');
        return new Response(null, { status: 200 });
      },
    });
    assert(result.valid === true, 'public HTTPS HEAD 200 accepted');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: publicLookup(),
      fetchImpl: async () =>
        new Response('x'.repeat(20000), { status: 200, headers: { 'content-length': '20000' } }),
    });
    assert(result.valid === false, 'oversized response rejected');
  }

  {
    const result = await validateDestinationUrl('https://example.com/', {
      lookup: publicLookup(),
      fetchImpl: async () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('aborted')), 10);
        }),
    });
    assert(result.valid === false, 'timeout/unreachable rejected');
  }

  assert(validateDestinationUrlSyntax('https://example.com/path').valid === true, 'syntax https ok');
  assert(validateDestinationUrlSyntax('https://127.0.0.1/').valid === false, 'syntax loopback rejected without fetch');
  assert(validateDestinationUrlSyntax('https://169.254.169.254/').valid === false, 'syntax metadata IP rejected without fetch');
  assert(validateDestinationUrlSyntax('Website').valid === false, 'wizard label is not a URL');

  console.log(`\n--- M7 SSRF SUMMARY: ${pass} PASS, ${fail} FAIL ---`);
  if (fail > 0) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
