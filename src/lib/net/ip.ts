/**
 * Authoritative IP classification for SSRF prevention.
 * Uses numeric range checks — never hostname substring matching.
 */

function parseIPv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

function ipv4InCidr(ip: number, prefix: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
  return (ip & mask) === (prefix & mask);
}

export function isBlockedIPv4(ip: number): boolean {
  if (ipv4InCidr(ip, parseIPv4('0.0.0.0')!, 8)) return true;
  if (ipv4InCidr(ip, parseIPv4('10.0.0.0')!, 8)) return true;
  if (ipv4InCidr(ip, parseIPv4('127.0.0.0')!, 8)) return true;
  if (ipv4InCidr(ip, parseIPv4('169.254.0.0')!, 16)) return true;
  if (ipv4InCidr(ip, parseIPv4('172.16.0.0')!, 12)) return true;
  if (ipv4InCidr(ip, parseIPv4('192.168.0.0')!, 16)) return true;
  if (ipv4InCidr(ip, parseIPv4('100.64.0.0')!, 10)) return true;
  if (ipv4InCidr(ip, parseIPv4('192.0.0.0')!, 24)) return true;
  if (ipv4InCidr(ip, parseIPv4('192.0.2.0')!, 24)) return true;
  if (ipv4InCidr(ip, parseIPv4('198.51.100.0')!, 24)) return true;
  if (ipv4InCidr(ip, parseIPv4('203.0.113.0')!, 24)) return true;
  if (ipv4InCidr(ip, parseIPv4('198.18.0.0')!, 15)) return true;
  if (ipv4InCidr(ip, parseIPv4('224.0.0.0')!, 4)) return true;
  if (ipv4InCidr(ip, parseIPv4('240.0.0.0')!, 4)) return true;
  if (ip === 0xffffffff) return true;
  return false;
}

function parseIPv6(ip: string): bigint | null {
  let s = ip.trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);

  let zoneIdx = s.indexOf('%');
  if (zoneIdx !== -1) s = s.slice(0, zoneIdx);

  const dotted = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let tailV4: number | null = null;
  if (dotted) {
    tailV4 = parseIPv4(dotted[2]);
    if (tailV4 === null) return null;
    s = dotted[1] + '0:0';
  }

  const sides = s.split('::');
  if (sides.length > 2) return null;

  const parseGroup = (part: string): number[] => {
    if (!part) return [];
    return part.split(':').map((g) => {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return -1;
      return parseInt(g, 16);
    });
  };

  let head = parseGroup(sides[0]);
  let tail = sides.length === 2 ? parseGroup(sides[1]) : [];
  if (head.includes(-1) || tail.includes(-1)) return null;

  const missing = 8 - (head.length + tail.length);
  if (sides.length === 2) {
    if (missing < 0) return null;
    head = [...head, ...Array(missing).fill(0), ...tail];
  } else if (head.length !== 8) {
    return null;
  }

  let value = BigInt(0);
  for (const g of head) value = (value << BigInt(16)) + BigInt(g);
  if (tailV4 !== null) {
    value = (value & ~BigInt('0xffffffff')) | BigInt(tailV4);
  }
  return value;
}

function ipv6InCidr(ip: bigint, prefix: bigint, bits: number): boolean {
  if (bits <= 0) return true;
  const shift = BigInt(128 - bits);
  return ip >> shift === prefix >> shift;
}

const V4_MAPPED = parseIPv6('::ffff:0:0')!;
const NAT64 = parseIPv6('64:ff9b::')!;
const SIXTO4 = parseIPv6('2002::')!;
const TEREDO = parseIPv6('2001::')!;

export function extractEmbeddedIPv4(ipv6: bigint): number | null {
  if (ipv6InCidr(ipv6, V4_MAPPED, 96)) return Number(ipv6 & BigInt('0xffffffff'));
  if (ipv6InCidr(ipv6, NAT64, 96)) return Number(ipv6 & BigInt('0xffffffff'));
  if (ipv6InCidr(ipv6, SIXTO4, 16)) return Number((ipv6 >> BigInt(80)) & BigInt('0xffffffff'));
  // Deprecated IPv4-compatible ::a.b.c.d (not ::ffff:mapped).
  if (ipv6InCidr(ipv6, BigInt(0), 96)) return Number(ipv6 & BigInt('0xffffffff'));
  // Teredo 2001:0000::/32 encodes the client IPv4 in the last 32 bits, XOR 0xffffffff.
  if (ipv6InCidr(ipv6, TEREDO, 32)) {
    return (Number(ipv6 & BigInt('0xffffffff')) ^ 0xffffffff) >>> 0;
  }
  return null;
}

export function isBlockedIPv6(ip: bigint): boolean {
  const embedded = extractEmbeddedIPv4(ip);
  if (embedded !== null && isBlockedIPv4(embedded)) return true;

  if (ip === BigInt(0)) return true; // ::/128
  if (ip === BigInt(1)) return true; // ::1/128
  if (ipv6InCidr(ip, parseIPv6('fe80::')!, 10)) return true; // link-local
  if (ipv6InCidr(ip, parseIPv6('fc00::')!, 7)) return true; // ULA
  if (ipv6InCidr(ip, parseIPv6('ff00::')!, 8)) return true; // multicast
  if (ipv6InCidr(ip, parseIPv6('2001:db8::')!, 32)) return true;
  if (ipv6InCidr(ip, parseIPv6('2001:10::')!, 28)) return true;
  if (ipv6InCidr(ip, parseIPv6('100::')!, 64)) return true;
  return false;
}

export function classifyAddress(address: string): 'public' | 'blocked' | 'invalid' {
  const v4 = parseIPv4(address);
  if (v4 !== null) return isBlockedIPv4(v4) ? 'blocked' : 'public';

  const v6 = parseIPv6(address);
  if (v6 !== null) return isBlockedIPv6(v6) ? 'blocked' : 'public';

  return 'invalid';
}

export function parseLiteralIP(hostname: string): string | null {
  let h = hostname.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (classifyAddress(h) === 'invalid') return null;
  return h;
}

export { parseIPv4, parseIPv6 };
