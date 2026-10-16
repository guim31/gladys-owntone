// The API client on its own: the password, the answers and errors of OwnTone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OwnToneClient, OwnToneError } from '../src/owntone/client.js';

function clientWith(answer, options = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return {
    client: new OwnToneClient({ host: '192.0.2.10', port: 3689, fetch, ...options }),
    calls,
  };
}

const reply = (status, body = '') => new Response(status === 204 ? null : body, { status });

test('a call: URL, JSON body, HTTP Basic with the user "admin" only when a password is set', async () => {
  const { client, calls } = clientWith(() => reply(204), { password: 'bench-secret' });
  assert.equal(await client.request('PUT', 'outputs/100', { selected: true }), null);
  assert.equal(calls[0].url, 'http://192.0.2.10:3689/api/outputs/100');
  assert.equal(calls[0].init.body, '{"selected":true}');
  assert.equal(
    calls[0].init.headers.Authorization,
    `Basic ${Buffer.from('admin:bench-secret').toString('base64')}`,
  );
  const open = clientWith(() => reply(200, '{ "state": "play" }'));
  assert.deepEqual(await open.client.request('GET', 'player'), { state: 'play' });
  assert.equal(open.calls[0].init.headers.Authorization, undefined);
});

test('the errors of OwnTone become stable codes', async () => {
  const code = async (answer) => {
    const { client } = clientWith(answer);
    const err = await client.request('GET', 'player').catch((e) => e);
    assert.ok(err instanceof OwnToneError);
    return err.code;
  };
  assert.equal(await code(() => reply(401, '<html>')), 'auth');
  assert.equal(await code(() => reply(403, '<html>')), 'forbidden');
  assert.equal(await code(() => reply(400, '<html>')), 'http');
  assert.equal(await code(() => reply(500, '<html>')), 'http');
  assert.equal(await code(() => reply(200, '<html>')), 'protocol');
  assert.equal(
    await code(() => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }),
    'unreachable',
  );
});

test('an IPv6 address is bracketed in the URL', async () => {
  const { client, calls } = clientWith(() => reply(200, '{}'));
  client.host = '2001:db8::1';
  await client.request('GET', 'config');
  assert.equal(calls[0].url, 'http://[2001:db8::1]:3689/api/config');
  assert.equal(client.address, '[2001:db8::1]:3689');
});
