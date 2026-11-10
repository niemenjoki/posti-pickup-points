// Live test against Posti with your own credentials. Prints the nearest points, never the credentials.
// node --env-file=.env examples/search.js 00100 [parcelLocker|pickupPoint]
// Reads POSTI_CLIENT_ID and POSTI_CLIENT_SECRET (or POSTI_API_CLIENT_ID and POSTI_API_CLIENT_SECRET).
import { PostiPickupError, createPostiPickupClient } from '../src/index.js';

const [postalCode = '00100', type = 'all'] = process.argv.slice(2);
try {
  const posti = createPostiPickupClient({
    clientId: process.env.POSTI_CLIENT_ID ?? process.env.POSTI_API_CLIENT_ID,
    clientSecret: process.env.POSTI_CLIENT_SECRET ?? process.env.POSTI_API_CLIENT_SECRET,
  });
  const points = await posti.search({ postalCode, type, limit: 5, language: 'fi' });
  console.log(`${points.length} points near ${postalCode}:`);
  for (const p of points) {
    const kind = p.parcelLocker ? 'locker' : 'pickup';
    console.log(`- ${p.name} (${kind}), ${p.street}, ${p.postalCode} ${p.city}, ${p.distanceInMeters ?? '?'} m`);
  }
} catch (error) {
  if (!(error instanceof PostiPickupError)) throw error;
  console.error(`Failed: ${error.code}${error.status ? ` (HTTP ${error.status})` : ''}`);
  process.exitCode = 1;
}
