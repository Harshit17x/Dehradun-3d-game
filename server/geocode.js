const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  res.setHeader?.('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

const inside = (lat, lng) => lat >= 30.24 && lat <= 30.43 && lng >= 77.94 && lng <= 78.17;

/** Server-side geocoding keeps the Google credential out of client bundles. */
export function createGeocodeMiddleware({ key = '', fetcher = globalThis.fetch } = {}) {
  return async function geocodeMiddleware(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!['/', '/api/geocode'].includes(url.pathname)) return next?.();
    if (req.method && req.method !== 'GET') return json(res, 405, { status: 'error', error: 'GET required' });
    const query = String(url.searchParams.get('q') || '').trim();
    if (query.length < 3 || query.length > 180) return json(res, 400, { status: 'error', error: 'Enter at least 3 characters.' });
    try {
      let results;
      if (key) {
        const google = new URL('https://maps.googleapis.com/maps/api/geocode/json');
        google.searchParams.set('address', `${query}, Dehradun, Uttarakhand, India`);
        google.searchParams.set('key', key);
        const response = await fetcher(google, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
        const body = await response.json();
        if (!response.ok || body.status === 'REQUEST_DENIED') throw new Error('Google geocoding is unavailable; check the API key and billing configuration.');
        results = (body.results || []).map((result) => ({
          name: result.formatted_address,
          lat: result.geometry?.location?.lat,
          lng: result.geometry?.location?.lng,
          source: 'Google Geocoding API',
        }));
      } else {
        const osm = new URL('https://nominatim.openstreetmap.org/search');
        osm.searchParams.set('q', `${query}, Dehradun, Uttarakhand, India`);
        osm.searchParams.set('format', 'jsonv2');
        osm.searchParams.set('limit', '5');
        const response = await fetcher(osm, { headers: { accept: 'application/json', 'user-agent': 'DehradunDrive/1.0 (local development)' }, signal: AbortSignal.timeout(12000) });
        if (!response.ok) throw new Error(`Public geocoder returned HTTP ${response.status}`);
        results = (await response.json()).map((result) => ({ name: result.display_name, lat: Number(result.lat), lng: Number(result.lon), source: 'OpenStreetMap Nominatim' }));
      }
      const inCity = results.filter((result) => Number.isFinite(result.lat) && Number.isFinite(result.lng) && inside(result.lat, result.lng));
      return json(res, 200, { status: 'ok', results: inCity, scope: 'Dehradun city region' });
    } catch (error) {
      return json(res, 502, { status: 'error', error: error.message || 'Geocoding failed' });
    }
  };
}
