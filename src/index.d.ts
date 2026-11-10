export type PostiPickupErrorCode =
  | 'missing_credentials'
  | 'missing_fetch'
  | 'invalid_postcode'
  | 'invalid_limit'
  | 'invalid_type'
  | 'auth_failed'
  | 'upstream_error'
  | 'invalid_response'
  | 'timeout'
  | 'network_error';

export class PostiPickupError extends Error {
  readonly name: 'PostiPickupError';
  readonly code: PostiPickupErrorCode;
  /** HTTP status from Posti, when the error came from a response. */
  readonly status: number | null;
  /** Parsed response body from Posti, when available. */
  readonly details: unknown;
}

export interface PostiPickupClientOptions {
  clientId: string;
  clientSecret: string;
  /** Default: https://gateway-auth.posti.fi/api/v1/token */
  authUrl?: string;
  /** Default: https://gateway.posti.fi */
  gatewayUrl?: string;
  /** Default: 2025-04 */
  apiVersion?: string;
  /** Per-request timeout. Default: 10000 */
  timeoutMs?: number;
  /** Custom fetch, e.g. for tests or proxies. Default: global fetch. */
  fetch?: typeof fetch;
  /** Clock for token expiry. Default: Date.now */
  now?: () => number;
}

export interface PickupPointSearchParams {
  postalCode: string;
  street?: string;
  city?: string;
  /** ISO 3166-1 alpha-2. Default: FI. Postcode format is validated only for FI. */
  countryCode?: string;
  /** Default: 8. Posti may cap the value. */
  limit?: number;
  /** Filter on the parcelLocker flag of each result. Default: all */
  type?: 'all' | 'parcelLocker' | 'pickupPoint';
  /** Drop Åland (22xxx) postcodes from input validation and results. Default: false */
  excludeAland?: boolean;
  /** Passed to Posti as searchCriteria.serviceFilters, e.g. { outdoorLocker: false }. */
  serviceFilters?: Record<string, boolean>;
  /** Sent as Accept-Language, e.g. fi, sv or en. */
  language?: string;
}

export interface PickupPoint {
  id: string;
  name: string;
  careOf: string;
  street: string;
  postalCode: string;
  city: string;
  municipality: string;
  countryCode: string;
  specificLocation: string;
  parcelLocker: boolean;
  routingServiceCode: string;
  distanceInMeters: number | null;
  /** The point exactly as Posti returned it. */
  raw: unknown;
}

export interface PostiPickupClient {
  search(params: PickupPointSearchParams): Promise<PickupPoint[]>;
  getAccessToken(): Promise<string>;
}

export function createPostiPickupClient(options: PostiPickupClientOptions): PostiPickupClient;
export function normalizePickupPoint(point: unknown): PickupPoint;
export function normalizePostalCode(value: unknown): string;
export function isFinnishPostalCode(value: string, options?: { excludeAland?: boolean }): boolean;
