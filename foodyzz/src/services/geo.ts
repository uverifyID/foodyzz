// Lightweight client-side geocoding + distance helpers used by the Explore
// radius filter. We geocode ZIP codes via the Google Maps Geocoding API (key
// comes from apiConfig/global.apiKeys.googleMap), cache by ZIP to minimise
// calls, and fall back to a built-in coordinate table (mirroring the Cloud
// Functions) when geocoding is unavailable so distances still render offline.

export interface Coords {
  lat: number;
  lng: number;
}

// Mirrors functions/src/index.ts ZIP_COORDS for consistent offline distances.
const ZIP_COORDS: Record<string, Coords> = {
  '10025': { lat: 40.798, lng: -73.968 },
  '10027': { lat: 40.812, lng: -73.961 },
  '10026': { lat: 40.802, lng: -73.952 },
  '10024': { lat: 40.789, lng: -73.974 },
  '10023': { lat: 40.775, lng: -73.982 },
  '10029': { lat: 40.791, lng: -73.944 },
  '10011': { lat: 40.741, lng: -74.0 },
  '10012': { lat: 40.725, lng: -73.996 },
};

const geocodeCache = new Map<string, Coords>();

// Deterministic offline fallback (mirrors the Cloud Functions logic) so the UI
// still shows a plausible distance when geocoding is unavailable.
function fallbackZipCoords(zip: string): Coords {
  const clean = (zip || '').trim();
  if (ZIP_COORDS[clean]) return ZIP_COORDS[clean];
  const num = parseInt(clean.replace(/\D/g, ''), 10) || 10025;
  const lat = 40.7 + ((num % 1000) / 1000) * 0.15;
  const lng = -74.0 + (((num * 3) % 1000) / 1000) * 0.12;
  return { lat, lng };
}

// Pull the first 5-digit ZIP out of a zipCode or free-form address string.
export function extractZip(value?: string | null): string {
  if (!value) return '';
  const match = String(value).match(/\d{5}/);
  return match ? match[0] : '';
}

export async function geocodeZip(zip: string, apiKey?: string): Promise<Coords> {
  const clean = (zip || '').trim();
  if (!clean) return fallbackZipCoords('10025');
  if (geocodeCache.has(clean)) return geocodeCache.get(clean)!;

  if (apiKey) {
    try {
      const url =
        `https://maps.googleapis.com/maps/api/geocode/json` +
        `?components=postal_code:${encodeURIComponent(clean)}|country:US&key=${apiKey}`;
      const res = await fetch(url);
      const data: any = await res.json();
      const loc = data?.results?.[0]?.geometry?.location;
      if (data?.status === 'OK' && loc) {
        const coords = { lat: loc.lat, lng: loc.lng };
        geocodeCache.set(clean, coords);
        return coords;
      }
      console.warn(`Geocoding for ${clean} returned status: ${data?.status}`);
    } catch (e) {
      console.warn('geocodeZip failed, using fallback for', clean, e);
    }
  }

  const fb = fallbackZipCoords(clean);
  geocodeCache.set(clean, fb);
  return fb;
}

// Geocodes a full address string using the Google Maps Geocoding API.
// Returns null if the address cannot be resolved — callers use this to block
// saves (validation) or fall back to ZIP geocoding (distance calculation).
export async function geocodeAddress(address: string, apiKey: string): Promise<Coords | null> {
  const cacheKey = address.trim().toLowerCase();
  if (!cacheKey) return null;
  if (geocodeCache.has(cacheKey)) return geocodeCache.get(cacheKey)!;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(address.trim())}&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    if (data?.status === 'OK' && loc) {
      const coords: Coords = { lat: loc.lat, lng: loc.lng };
      geocodeCache.set(cacheKey, coords);
      return coords;
    }
    console.warn(`geocodeAddress: ${data?.status} for "${address}"`);
    return null;
  } catch (e) {
    console.warn('geocodeAddress failed for', address, e);
    return null;
  }
}

// ─── Google Places autocomplete helpers ──────────────────────────────────────
// Mirrors the scrubshq onboarding wizard so address entry feels identical across
// apps. Callers pass apiConfig/global.apiKeys.googleMap as `apiKey`.

export interface PlacePrediction {
  description: string;
  place_id: string;
}

export async function fetchPlaceSuggestions(input: string, apiKey: string): Promise<PlacePrediction[]> {
  if (!apiKey || !input.trim() || input.trim().length < 3) return [];
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
      `?input=${encodeURIComponent(input.trim())}` +
      `&types=address` +
      `&components=country:us` +
      `&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (data?.status === 'OK' || data?.status === 'ZERO_RESULTS') {
      return (data.predictions || []).map((p: any) => ({
        description: p.description,
        place_id: p.place_id,
      }));
    }
    console.warn('fetchPlaceSuggestions status:', data?.status);
    return [];
  } catch (e) {
    console.warn('fetchPlaceSuggestions error:', e);
    return [];
  }
}

// Resolves a place_id to its formatted address (the canonical string we store).
export async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<string> {
  if (!apiKey || !placeId) return '';
  try {
    const url =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(placeId)}` +
      `&fields=formatted_address` +
      `&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    return data?.result?.formatted_address || '';
  } catch (e) {
    console.warn('fetchPlaceDetails error:', e);
    return '';
  }
}

// Geocodes a free-form query (full address OR a bare school name) to both coords
// and zip in a single Geocoding API call. Used to anchor provider search on a
// school dorm (campus centroid) or a one-off pickup address. Cached by query.
const detailedCache = new Map<string, { coords: Coords; zip: string }>();

export async function geocodeDetailed(
  query: string,
  apiKey?: string,
): Promise<{ coords: Coords; zip: string } | null> {
  const cacheKey = (query || '').trim().toLowerCase();
  if (!cacheKey || !apiKey) return null;
  if (detailedCache.has(cacheKey)) return detailedCache.get(cacheKey)!;
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?address=${encodeURIComponent(query.trim())}&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    const result = data?.results?.[0];
    const loc = result?.geometry?.location;
    if (data?.status === 'OK' && loc) {
      const zipComp = (result.address_components || []).find((c: any) =>
        Array.isArray(c.types) && c.types.includes('postal_code'),
      );
      const out = {
        coords: { lat: loc.lat, lng: loc.lng } as Coords,
        zip: zipComp?.short_name || zipComp?.long_name || extractZip(result.formatted_address) || '',
      };
      detailedCache.set(cacheKey, out);
      return out;
    }
    console.warn(`geocodeDetailed: ${data?.status} for "${query}"`);
    return null;
  } catch (e) {
    console.warn('geocodeDetailed failed for', query, e);
    return null;
  }
}

// Reverse-geocode coordinates → ZIP. Used when a place (e.g. a school) resolves to
// coords but the forward result carried no postal_code component, so the search
// anchor's displayed ZIP stays consistent with the coords actually being searched.
export async function reverseGeocodeZip(coords: Coords, apiKey?: string): Promise<string> {
  if (!apiKey) return '';
  try {
    const url =
      `https://maps.googleapis.com/maps/api/geocode/json` +
      `?latlng=${coords.lat},${coords.lng}&result_type=postal_code&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    for (const result of data?.results ?? []) {
      const zipComp = (result.address_components || []).find((c: any) =>
        Array.isArray(c.types) && c.types.includes('postal_code'),
      );
      const zip = zipComp?.short_name || zipComp?.long_name || extractZip(result.formatted_address);
      if (zip) return zip;
    }
    return '';
  } catch (e) {
    console.warn('reverseGeocodeZip failed', e);
    return '';
  }
}

// Great-circle distance between two coordinates, in miles.
export function haversineMiles(a: Coords, b: Coords): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
