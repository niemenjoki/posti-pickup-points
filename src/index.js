const DEFAULT_AUTH_URL = 'https://gateway-auth.posti.fi/api/v1/token';
const DEFAULT_GATEWAY_URL = 'https://gateway.posti.fi';
const DEFAULT_API_VERSION = '2025-04';
const DEFAULT_LIMIT = 8;
// With a type or Åland filter some results are dropped after the search, so Posti is asked for more.
const FILTER_OVERFETCH_FACTOR = 3;
const FILTER_MAX_REQUEST_LIMIT = 50;
const DEFAULT_TIMEOUT_MS = 10_000;
// Refresh the token this long before it expires.
const TOKEN_REFRESH_MARGIN_MS = 30_000;
const POINT_TYPES = new Set(['all', 'parcelLocker', 'pickupPoint']);

export class PostiPickupError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{ status?: number, details?: unknown, cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PostiPickupError';
    this.code = code;
    this.status = options.status ?? null;
    this.details = options.details ?? null;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

export function normalizePostalCode(value) {
  return text(value).replace(/\s+/g, '');
}

/** Five digits. Åland postcodes start with 22. */
export function isFinnishPostalCode(value, { excludeAland = false } = {}) {
  return /^\d{5}$/.test(value) && !(excludeAland && value.startsWith('22'));
}

export function normalizePickupPoint(point) {
  const location = point?.location ?? {};
  const distance = Number(point?.distanceInMeters);

  return {
    id: text(point?.id),
    name: text(point?.publicName),
    careOf: text(point?.careOf),
    street: text(location.street),
    postalCode: text(location.postcode),
    city: text(location.city),
    municipality: text(location.municipality),
    countryCode: text(location.countryCode),
    specificLocation: text(location.specificLocation),
    parcelLocker: Boolean(point?.parcelLocker),
    routingServiceCode: text(point?.routingServiceCode),
    distanceInMeters:
      point?.distanceInMeters !== null &&
      point?.distanceInMeters !== undefined &&
      Number.isFinite(distance) &&
      distance >= 0
        ? distance
        : null,
    raw: point,
  };
}

function resolveLimit(value) {
  if (value === undefined || value === null) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1) {
    throw new PostiPickupError('invalid_limit', 'limit must be a positive integer.');
  }
  return value;
}

function trimSlashes(url) {
  return url.replace(/\/+$/, '');
}

/**
 * @param {import('./index').PostiPickupClientOptions} options
 * @returns {import('./index').PostiPickupClient}
 */
export function createPostiPickupClient(options = {}) {
  const clientId = text(options.clientId);
  const clientSecret = text(options.clientSecret);
  if (!clientId || !clientSecret) {
    throw new PostiPickupError('missing_credentials', 'clientId and clientSecret are required. Did you load your .env file?');
  }

  const authUrl = text(options.authUrl) || DEFAULT_AUTH_URL;
  const gatewayUrl = trimSlashes(text(options.gatewayUrl) || DEFAULT_GATEWAY_URL);
  const apiVersion = text(options.apiVersion) || DEFAULT_API_VERSION;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  if (typeof fetchImpl !== 'function') {
    throw new PostiPickupError('missing_fetch', 'No fetch implementation available (Node.js 18+ required).');
  }

  let token = { value: '', expiresAt: 0 };
  let pendingToken = null;

  async function request(url, init, failureCode) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
      throw new PostiPickupError(
        timedOut ? 'timeout' : 'network_error',
        timedOut ? `Posti did not respond within ${timeoutMs} ms.` : 'Request to Posti failed.',
        { cause: error }
      );
    }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const hint =
        failureCode === 'auth_failed' && response.status === 401 ? ' Check clientId and clientSecret.' : '';
      throw new PostiPickupError(failureCode, `Posti responded with HTTP ${response.status}.${hint}`, {
        status: response.status,
        details: body,
      });
    }
    return body;
  }

  async function fetchToken() {
    const body = await request(
      authUrl,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      },
      'auth_failed'
    );
    if (!body?.access_token) {
      throw new PostiPickupError('auth_failed', 'Token response did not contain access_token.');
    }
    const expiresInSeconds = Math.max(60, Number(body.expires_in) || 300);
    token = { value: body.access_token, expiresAt: now() + expiresInSeconds * 1000 };
    return token.value;
  }

  async function getAccessToken() {
    if (token.value && token.expiresAt > now() + TOKEN_REFRESH_MARGIN_MS) {
      return token.value;
    }
    // Concurrent searches share one token request.
    pendingToken ??= fetchToken().finally(() => {
      pendingToken = null;
    });
    return pendingToken;
  }

  async function search(params = {}) {
    const countryCode = text(params.countryCode || 'FI').toUpperCase();
    const postalCode = normalizePostalCode(params.postalCode);
    const type = params.type ?? 'all';
    const limit = resolveLimit(params.limit);

    if (!postalCode) {
      throw new PostiPickupError('invalid_postcode', 'postalCode is required.');
    }
    if (countryCode === 'FI' && !isFinnishPostalCode(postalCode, params)) {
      throw new PostiPickupError('invalid_postcode', `"${postalCode}" is not a valid Finnish postcode.`);
    }
    if (!POINT_TYPES.has(type)) {
      throw new PostiPickupError('invalid_type', 'type must be "all", "parcelLocker" or "pickupPoint".');
    }

    const street = text(params.street);
    const city = text(params.city);
    const filtered = type !== 'all' || (countryCode === 'FI' && Boolean(params.excludeAland));
    const requestLimit = filtered
      ? Math.max(limit, Math.min(limit * FILTER_OVERFETCH_FACTOR, FILTER_MAX_REQUEST_LIMIT))
      : limit;
    const payload = JSON.stringify({
      searchCriteria: {
        location: {
          postcode: postalCode,
          countryCode,
          ...(street ? { street } : {}),
          ...(city ? { city } : {}),
        },
        serviceFilters: params.serviceFilters ?? {},
      },
      limit: requestLimit,
    });
    const send = async () =>
      request(
        `${gatewayUrl}/${apiVersion}/pickuppoints`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            ...(params.language ? { 'Accept-Language': params.language } : {}),
            Authorization: `Bearer ${await getAccessToken()}`,
            'Content-Type': 'application/json',
          },
          body: payload,
        },
        'upstream_error'
      );

    let body;
    try {
      body = await send();
    } catch (error) {
      // A token revoked before its expiry: fetch a new one and retry once.
      if (error?.code !== 'upstream_error' || error.status !== 401) throw error;
      token = { value: '', expiresAt: 0 };
      body = await send();
    }

    if (!Array.isArray(body?.pickupPoints)) {
      throw new PostiPickupError('invalid_response', 'Response did not contain a pickupPoints array.', {
        details: body,
      });
    }

    return body.pickupPoints
      .map(normalizePickupPoint)
      .filter((point) => type === 'all' || point.parcelLocker === (type === 'parcelLocker'))
      .filter(
        (point) =>
          !(countryCode === 'FI' && params.excludeAland) ||
          isFinnishPostalCode(point.postalCode, { excludeAland: true })
      )
      .slice(0, limit);
  }

  return { search, getAccessToken };
}
