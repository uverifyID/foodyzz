// Provider addresses are stored only as a formatted string (from a Google Places
// prediction or manual entry), e.g. "8 Nursery Ct, Huntington, NY 11743, USA".
// The provider's SERVICE-AREA zip — what broadcast order matching keys off — must
// be derived from that address, NOT from the login store identifier. Pull the
// 5-digit zip out of the address: prefer the zip that follows a 2-letter state
// code, otherwise fall back to the last standalone 5-digit group (the zip always
// trails the street number in a US address).
export function extractZipFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const stateZip = address.match(/\b[A-Z]{2}\s+(\d{5})(?:-\d{4})?\b/);
  if (stateZip) return stateZip[1];
  const allZips = address.match(/\b\d{5}\b/g);
  return allZips ? allZips[allZips.length - 1] : null;
}
