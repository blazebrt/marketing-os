import { URL } from 'url';

export async function validateDestinationUrl(urlStr: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const parsed = new URL(urlStr);
    
    // Must be HTTPS for production safety
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Destination URL must use HTTPS' };
    }

    // Reject private/localhost
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.includes('127.0.0.1') ||
      hostname.includes('0.0.0.0') ||
      hostname.includes('::1') ||
      hostname.endsWith('.local') ||
      hostname.includes('192.168.') ||
      hostname.includes('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      return { valid: false, error: 'Private or internal destination URLs are not allowed' };
    }

    // Safe fetch with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 sec timeout

    try {
      const response = await fetch(urlStr, { 
        method: 'HEAD', // light request
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Marketing-OS-Validator/1.0'
        }
      });
      clearTimeout(timeoutId);

      if (!response.ok && response.status !== 405 && response.status !== 403) {
        // Some sites reject HEAD or block bots with 403, we might allow 403 but let's be strict for now, or just check it didn't completely fail.
        // Google Ads requires a working URL (HTTP 200). We will require 200 or similar success.
        if (response.status >= 400 && response.status !== 405 && response.status !== 403) {
          return { valid: false, error: `Destination URL returned HTTP ${response.status}` };
        }
      }

      return { valid: true };
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      return { valid: false, error: 'Destination URL is unreachable: ' + fetchErr.message };
    }

  } catch (e: any) {
    return { valid: false, error: 'Invalid URL format' };
  }
}
