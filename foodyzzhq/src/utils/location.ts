import * as Location from 'expo-location';
import { Alert } from 'react-native';

export type ProviderCoords = { lat: number; lng: number };

// A live GPS fix must never hold up a status advance: indoors / on a cold fix
// getCurrentPositionAsync can block for many seconds. Bound it and fall back to the
// last known position so the map pin is best-effort, never blocking.
const GPS_TIMEOUT_MS = 5000;    // give up on a fresh fix after this
const GPS_MAX_AGE_MS = 60000;   // a cached fix up to a minute old is fine for a pin

// Requests foreground location permission (the OS only prompts the first time) and
// returns the device's current GPS coordinates. Returns null when permission is
// denied or a fix can't be obtained in time — callers must treat location as
// best-effort and still advance the order status, so a provider who declines location
// (or is somewhere with poor signal) never gets blocked from working.
export async function getCurrentProviderCoords(): Promise<ProviderCoords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    // Race a live fix against a timeout; .catch keeps a late rejection from becoming
    // an unhandled rejection once the timeout has already won.
    const live = Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), GPS_TIMEOUT_MS));
    let pos = await Promise.race([live, timeout]);

    // Timed out or failed → accept a recent cached fix if one exists.
    if (!pos) {
      pos = await Location.getLastKnownPositionAsync({ maxAge: GPS_MAX_AGE_MS }).catch(() => null);
    }
    if (!pos) return null;
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

// A provider who keeps location off shouldn't get a modal on every single status tap.
// Warn once per app session; the status still advances regardless.
let locationWarnShown = false;
export function warnLocationUnavailableOnce(): void {
  if (locationWarnShown) return;
  locationWarnShown = true;
  Alert.alert(
    'Location unavailable',
    "Can't detect your location — turn on Location access for this app and check your Wi‑Fi/GPS signal. Your status still updated; the customer just won't see your live pin.",
  );
}
