# posti-pickup-points: Posti pickup point and parcel locker search for Node.js

[![npm version](https://img.shields.io/npm/v/@niemenjoki/posti-pickup-points)](https://www.npmjs.com/package/@niemenjoki/posti-pickup-points)
[![npm downloads](https://img.shields.io/npm/dm/@niemenjoki/posti-pickup-points)](https://www.npmjs.com/package/@niemenjoki/posti-pickup-points)
[![tests](https://img.shields.io/github/actions/workflow/status/niemenjoki/posti-pickup-points/test.yml?branch=main&label=tests)](https://github.com/niemenjoki/posti-pickup-points/actions/workflows/test.yml)
[![license](https://img.shields.io/npm/l/@niemenjoki/posti-pickup-points)](LICENSE)
[![node](https://img.shields.io/node/v/@niemenjoki/posti-pickup-points)](package.json)

English | [Suomi](https://github.com/niemenjoki/posti-pickup-points/blob/main/README.fi.md)

Search Posti pickup points and parcel lockers near a Finnish postcode, for example for the delivery options in an
online shop's checkout. Uses Posti's
[Pickup Point API](https://developer.posti.com/) (version `2025-04`).

- OAuth token is fetched once and cached until 30 s before expiry. Concurrent searches share one token request.
- A token rejected with HTTP 401 is replaced and the search retried once.
- Results are normalized to a flat, typed shape. The original object is kept in `raw`.
- No dependencies. Node.js 18.17 or newer (global `fetch`).

Not affiliated with Posti. You need your own API credentials from Posti (ordered through Posti's LogEDI contact).

**Suomeksi:** Postin noutopisteiden ja pakettiautomaattien haku postinumerolla Node.js:llä, esimerkiksi verkkokaupan
kassalle. [Ohje suomeksi](https://github.com/niemenjoki/posti-pickup-points/blob/main/README.fi.md).

Output of the included example with real credentials (tested against the live API on 10 November 2026):

```text
$ node --env-file=.env examples/search.js 00100
5 points near 00100:
- Postin automaatti, Lidl Graniittitalo (locker), Salomonkatu 13, 00104 Helsinki, 319 m
- Posti, K-Market Etu-Töölö (pickup), Lapuankatu 4, 00100 Helsinki, 322 m
- Posti, K-Market BiiliTalo (pickup), Salomonkatu 17, 00100 Helsinki, 351 m
- Postin automaatti, K-Market BiiliTalo (locker), Salomonkatu 17, 00104 Helsinki, 351 m
- Postin automaatti, Lidl Sähkötalo (locker), Kampinkuja 2, 00104 Helsinki, 410 m
```

## Install

```sh
npm install @niemenjoki/posti-pickup-points
```

## Usage

Run this on your server only. Never send the client secret to a browser.

```js
import { createPostiPickupClient, PostiPickupError } from '@niemenjoki/posti-pickup-points';

const posti = createPostiPickupClient({
  clientId: process.env.POSTI_CLIENT_ID,
  clientSecret: process.env.POSTI_CLIENT_SECRET,
});

try {
  const points = await posti.search({ postalCode: '00100', limit: 5 });
  for (const p of points) console.log(p.name, p.street, p.distanceInMeters);
} catch (error) {
  if (error instanceof PostiPickupError) console.error(error.code, error.status);
  else throw error;
}
```

Create the client once and reuse it, so the token cache works.

### Search options

| Option | Default | Notes |
|---|---|---|
| `postalCode` | required | Spaces are removed. For `FI` it must be five digits. |
| `street`, `city` | - | Optional. Narrows the search location. |
| `countryCode` | `FI` | Postcode format is checked only for `FI`. |
| `limit` | `8` | Positive integer, the most results returned. With `type` or `excludeAland`, up to three times as many points (at most 50) are requested from Posti, so the filtered list is usually full. Posti may apply its own maximum. |
| `type` | `all` | `parcelLocker` or `pickupPoint`, filtered on the result's `parcelLocker` flag. |
| `excludeAland` | `false` | Rejects Åland (22xxx) input and drops Åland results, e.g. when Åland deliveries need customs handling. |
| `serviceFilters` | `{}` | Passed to Posti unchanged, e.g. `{ outdoorLocker: false }`. See Posti's API documentation for the filter names. |
| `language` | - | Sent as `Accept-Language` (`fi`, `sv`, `en`). |

### Result

```ts
{
  id: string; name: string; careOf: string;
  street: string; postalCode: string; city: string; municipality: string; countryCode: string;
  specificLocation: string; parcelLocker: boolean; routingServiceCode: string;
  distanceInMeters: number | null; raw: unknown;
}
```

Missing text fields are empty strings. `distanceInMeters` is `null` when Posti does not return a valid number.

### Client options

`authUrl`, `gatewayUrl` and `apiVersion` override the defaults (`https://gateway-auth.posti.fi/api/v1/token`,
`https://gateway.posti.fi`, `2025-04`). `timeoutMs` (default 10000) applies to each request. `fetch` and `now`
can be replaced, for example in tests.

### Errors

Every failure is a `PostiPickupError` with a `code`:

| Code | When |
|---|---|
| `missing_credentials`, `missing_fetch` | Client creation |
| `invalid_postcode`, `invalid_limit`, `invalid_type` | Bad input. Nothing is sent to Posti. |
| `auth_failed` | Token request failed or returned no token |
| `upstream_error` | Search returned a non-2xx status (`status` and `details` are set) |
| `invalid_response` | Search response had no `pickupPoints` array |
| `timeout`, `network_error` | No response |

## Tests

```sh
npm test
```

To try the live API with your own credentials, put `POSTI_CLIENT_ID` and `POSTI_CLIENT_SECRET` in a `.env` file
and run `node --env-file=.env examples/search.js 00100` (add `parcelLocker` or `pickupPoint` to filter).

The tests use a fake `fetch` and synthetic responses in `test/fixtures` (fictional places). They do not call Posti.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
