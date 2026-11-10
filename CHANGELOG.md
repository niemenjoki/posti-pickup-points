# Changelog

## 1.0.2 - 2026-11-10

- Error messages: `missing_credentials` asks whether the `.env` file was loaded, and `auth_failed` with
  HTTP 401 says to check `clientId` and `clientSecret`. Error codes are unchanged.
- README: the package is an ES module only; how to use it from CommonJS.

## 1.0.1 - 2026-11-10

- Published from GitHub Actions with npm provenance. No code changes.

## 1.0.0 - 2026-11-10

First public release.

- Search Posti pickup points and parcel lockers near a postcode with the Pickup Point API (version 2025-04).
- OAuth token cache shared by concurrent searches, one retry after HTTP 401.
- Normalized, typed results with the original object in `raw`.
- Filters for point type and Åland. With a filter, more points are requested from Posti so that up to `limit`
  results are returned.
- Tested against the live API with real credentials.
