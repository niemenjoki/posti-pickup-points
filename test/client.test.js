import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  PostiPickupError,
  createPostiPickupClient,
  isFinnishPostalCode,
  normalizePickupPoint,
  normalizePostalCode,
} from '../src/index.js';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));

const TOKEN = { access_token: 'token-1', expires_in: 3600 };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fake fetch that answers token and search requests from a queue. */
function fakeFetch({ tokens = [TOKEN], searches = [] } = {}) {
  const calls = [];
  const tokenQueue = [...tokens];
  const searchQueue = [...searches];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/token')) {
      const next = tokenQueue.shift() ?? TOKEN;
      return next instanceof Response ? next : json(next);
    }
    const next = searchQueue.shift();
    if (next instanceof Error) throw next;
    return next instanceof Response ? next : json(next);
  };
  return { impl, calls };
}

function client(fetch, extra = {}) {
  return createPostiPickupClient({ clientId: 'id', clientSecret: 'secret', fetch, ...extra });
}

test('postcode helpers', () => {
  assert.equal(normalizePostalCode(' 00 100 '), '00100');
  assert.equal(isFinnishPostalCode('00100'), true);
  assert.equal(isFinnishPostalCode('0010'), false);
  assert.equal(isFinnishPostalCode('22100'), true);
  assert.equal(isFinnishPostalCode('22100', { excludeAland: true }), false);
});

test('normalizes a pickup point and keeps the raw object', () => {
  const raw = fixture('search-00100.json').pickupPoints[0];
  const point = normalizePickupPoint(raw);
  assert.deepEqual(
    { ...point, raw: undefined },
    {
      id: '1001',
      name: 'Example Market Keskusta',
      careOf: 'Example Market Oy',
      street: 'Esimerkkikatu 1',
      postalCode: '00100',
      city: 'HELSINKI',
      municipality: 'Helsinki',
      countryCode: 'FI',
      specificLocation: 'Inside, next to the entrance',
      parcelLocker: false,
      routingServiceCode: '2103',
      distanceInMeters: 120,
      raw: undefined,
    }
  );
  assert.equal(point.raw, raw);
});

test('invalid or missing distance becomes null, zero stays zero', () => {
  assert.equal(normalizePickupPoint({ distanceInMeters: 'x' }).distanceInMeters, null);
  assert.equal(normalizePickupPoint({ distanceInMeters: null }).distanceInMeters, null);
  assert.equal(normalizePickupPoint({ distanceInMeters: -5 }).distanceInMeters, null);
  assert.equal(normalizePickupPoint({ distanceInMeters: 0 }).distanceInMeters, 0);
});

test('search sends the expected token and search requests', async () => {
  const { impl, calls } = fakeFetch({ searches: [fixture('search-00100.json')] });
  const points = await client(impl).search({
    postalCode: '00100',
    street: 'Esimerkkikatu 1',
    limit: 3,
    language: 'fi',
    serviceFilters: { outdoorLocker: false },
  });

  assert.equal(points.length, 3);
  assert.equal(calls.length, 2);

  const [tokenCall, searchCall] = calls;
  assert.equal(tokenCall.url, 'https://gateway-auth.posti.fi/api/v1/token');
  const form = new URLSearchParams(tokenCall.init.body);
  assert.equal(form.get('grant_type'), 'client_credentials');
  assert.equal(form.get('client_id'), 'id');
  assert.equal(form.get('client_secret'), 'secret');

  assert.equal(searchCall.url, 'https://gateway.posti.fi/2025-04/pickuppoints');
  assert.equal(searchCall.init.headers.Authorization, 'Bearer token-1');
  assert.equal(searchCall.init.headers['Accept-Language'], 'fi');
  assert.deepEqual(JSON.parse(searchCall.init.body), {
    searchCriteria: {
      location: { postcode: '00100', countryCode: 'FI', street: 'Esimerkkikatu 1' },
      serviceFilters: { outdoorLocker: false },
    },
    limit: 3,
  });
});

test('reuses the token until it is close to expiry', async () => {
  let clock = 1_000_000;
  const { impl, calls } = fakeFetch({
    tokens: [{ access_token: 'a', expires_in: 120 }, { access_token: 'b', expires_in: 120 }],
    searches: [fixture('search-00100.json'), fixture('search-00100.json'), fixture('search-00100.json')],
  });
  const c = client(impl, { now: () => clock });

  await c.search({ postalCode: '00100' });
  clock += 60_000;
  await c.search({ postalCode: '00100' });
  clock += 40_000; // 20 s left, inside the 30 s margin
  await c.search({ postalCode: '00100' });

  const auths = calls.filter((call) => !call.url.includes('/token')).map((call) => call.init.headers.Authorization);
  assert.deepEqual(auths, ['Bearer a', 'Bearer a', 'Bearer b']);
});

test('concurrent searches share one token request', async () => {
  const data = fixture('search-00100.json');
  const { impl, calls } = fakeFetch({ searches: [data, data, data] });
  const c = client(impl);
  await Promise.all([c.search({ postalCode: '00100' }), c.search({ postalCode: '00100' }), c.search({ postalCode: '00100' })]);
  assert.equal(calls.filter((call) => call.url.includes('/token')).length, 1);
});

test('retries once with a new token after 401', async () => {
  const { impl, calls } = fakeFetch({
    tokens: [{ access_token: 'old', expires_in: 3600 }, { access_token: 'new', expires_in: 3600 }],
    searches: [json({ message: 'expired' }, 401), fixture('search-00100.json')],
  });
  const points = await client(impl).search({ postalCode: '00100' });
  assert.equal(points.length, 3);
  const auths = calls.filter((call) => !call.url.includes('/token')).map((call) => call.init.headers.Authorization);
  assert.deepEqual(auths, ['Bearer old', 'Bearer new']);
});

test('type filter uses the parcelLocker flag', async () => {
  const data = fixture('search-00100.json');
  const { impl } = fakeFetch({ searches: [data, data] });
  const c = client(impl);
  assert.deepEqual((await c.search({ postalCode: '00100', type: 'parcelLocker' })).map((p) => p.id), ['1002']);
  assert.deepEqual((await c.search({ postalCode: '00100', type: 'pickupPoint' })).map((p) => p.id), ['1001', '1003']);
});

test('a type filter asks Posti for more points and returns at most limit', async () => {
  const data = fixture('search-00100.json');
  const { impl, calls } = fakeFetch({ searches: [data, data, data] });
  const c = client(impl);
  const sentLimit = () => JSON.parse(calls.at(-1).init.body).limit;

  assert.deepEqual((await c.search({ postalCode: '00100', type: 'pickupPoint', limit: 1 })).map((p) => p.id), ['1001']);
  assert.equal(sentLimit(), 3);
  await c.search({ postalCode: '00100', type: 'parcelLocker', limit: 20 });
  assert.equal(sentLimit(), 50);
  await c.search({ postalCode: '00100', limit: 2 });
  assert.equal(sentLimit(), 2);
});

test('excludeAland rejects Åland input and drops Åland results', async () => {
  const { impl } = fakeFetch({ searches: [fixture('search-22100.json'), fixture('search-22100.json')] });
  const c = client(impl);
  await assert.rejects(c.search({ postalCode: '22100', excludeAland: true }), { code: 'invalid_postcode' });
  assert.deepEqual((await c.search({ postalCode: '20100', excludeAland: true })).map((p) => p.id), ['2002']);
  assert.deepEqual((await c.search({ postalCode: '22100' })).map((p) => p.id), ['2001', '2002']);
});

test('input validation', async () => {
  const { impl, calls } = fakeFetch();
  const c = client(impl);
  await assert.rejects(c.search({ postalCode: '' }), { code: 'invalid_postcode' });
  await assert.rejects(c.search({ postalCode: '1234' }), { code: 'invalid_postcode' });
  await assert.rejects(c.search({ postalCode: '00100', limit: 0 }), { code: 'invalid_limit' });
  await assert.rejects(c.search({ postalCode: '00100', limit: 2.5 }), { code: 'invalid_limit' });
  await assert.rejects(c.search({ postalCode: '00100', type: 'locker' }), { code: 'invalid_type' });
  assert.equal(calls.length, 0, 'invalid input must not reach Posti');
  assert.throws(() => createPostiPickupClient({ clientId: 'id' }), { code: 'missing_credentials' });
});

test('non-FI postcodes are passed through without format check', async () => {
  const { impl, calls } = fakeFetch({ searches: [{ pickupPoints: [] }] });
  await client(impl).search({ postalCode: '0150', countryCode: 'no' });
  assert.equal(JSON.parse(calls[1].init.body).searchCriteria.location.countryCode, 'NO');
});

test('error mapping', async () => {
  const cases = [
    [{ tokens: [json({ error: 'invalid_client' }, 401)] }, 'auth_failed', 401],
    [{ tokens: [{ token_type: 'bearer' }] }, 'auth_failed', null],
    [{ searches: [json({ message: 'down' }, 503)] }, 'upstream_error', 503],
    [{ searches: [{ results: [] }] }, 'invalid_response', null],
    [{ searches: [new TypeError('fetch failed')] }, 'network_error', null],
    [{ searches: [Object.assign(new Error('t'), { name: 'TimeoutError' })] }, 'timeout', null],
  ];
  for (const [setup, code, status] of cases) {
    const { impl } = fakeFetch(setup);
    await assert.rejects(client(impl).search({ postalCode: '00100' }), (error) => {
      assert.ok(error instanceof PostiPickupError);
      assert.equal(error.code, code);
      assert.equal(error.status, status);
      return true;
    });
  }
});

test('custom gateway, version and auth URL', async () => {
  const { impl, calls } = fakeFetch({ searches: [{ pickupPoints: [] }] });
  await client(impl, {
    authUrl: 'https://auth.example.test/token',
    gatewayUrl: 'https://gw.example.test///',
    apiVersion: '2026-04',
  }).search({ postalCode: '00100' });
  assert.equal(calls[0].url, 'https://auth.example.test/token');
  assert.equal(calls[1].url, 'https://gw.example.test/2026-04/pickuppoints');
});
