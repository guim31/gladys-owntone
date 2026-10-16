import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHost } from '../src/config.js';

test('the address: host, host:port, IPv6, the web interface URL', () => {
  assert.deepEqual(parseHost('192.0.2.10'), { host: '192.0.2.10', port: null });
  assert.deepEqual(parseHost(' owntone.lan:3690 '), { host: 'owntone.lan', port: 3690 });
  assert.deepEqual(parseHost('[2001:db8::1]:3689'), { host: '2001:db8::1', port: 3689 });
  assert.deepEqual(parseHost('http://192.0.2.10:3689/'), { host: '192.0.2.10', port: 3689 });
  assert.deepEqual(parseHost('nas.lan:80'), { host: 'nas.lan', port: 80 });
  for (const bad of [
    '',
    '  ',
    'https://owntone.lan',
    'tcp://x',
    'a b',
    'user@host',
    'x/y',
    'host:0',
    'host:70000',
  ]) {
    assert.equal(parseHost(bad), null, bad);
  }
});

test('normalization: defaults, port, password kept as typed, language', () => {
  assert.deepEqual(normalizeConfig({}), {
    configured: false,
    valid: false,
    host: '',
    port: 3689,
    password: '',
    language: 'fr',
  });
  const config = normalizeConfig({
    host: 'owntone.lan',
    port: '3700',
    password: ' s3cret ',
    language: 'de',
  });
  assert.equal(config.port, 3700);
  assert.equal(config.password, ' s3cret ');
  assert.equal(config.language, 'de');
  assert.equal(normalizeConfig({ host: 'owntone.lan:3800', port: 3700 }).port, 3800);
  assert.equal(normalizeConfig({ host: 'x', port: 70000, language: 'it' }).port, 3689);
  assert.equal(normalizeConfig({ host: 'x', language: 'it' }).language, DEFAULT_CONFIG.language);
});
