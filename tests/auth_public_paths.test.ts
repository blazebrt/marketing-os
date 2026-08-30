import assert from 'node:assert/strict';
import { isUnauthenticatedPublicPath } from '../src/lib/auth/publicPaths';

assert.equal(isUnauthenticatedPublicPath('/login'), true);
assert.equal(isUnauthenticatedPublicPath('/login/'), true);
assert.equal(isUnauthenticatedPublicPath('/api/leads'), true);
assert.equal(isUnauthenticatedPublicPath('/api/interactions'), true);
assert.equal(isUnauthenticatedPublicPath('/api/cron/refresh-metrics'), true);
assert.equal(isUnauthenticatedPublicPath('/api/integrations/google/callback'), true);
assert.equal(isUnauthenticatedPublicPath('/loginfoo'), false);
assert.equal(isUnauthenticatedPublicPath('/login-extra'), false);
assert.equal(isUnauthenticatedPublicPath('/api/integrations/google/callback/evil'), false);
assert.equal(isUnauthenticatedPublicPath('/api/cron'), false);
assert.equal(isUnauthenticatedPublicPath('/dashboard'), false);
assert.equal(isUnauthenticatedPublicPath('/api/integrations/disconnect'), false);

console.log('auth public path tests passed');
