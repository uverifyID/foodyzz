// NYC's Bicycle Safety Course for delivery workers (DeliverSafely). Riders confirm
// it at checkout and give the Completion ID from their certificate; the ID is kept
// on users/{phone}.bikeSafetyCompletionId so a repeat rider never re-types it.
//
// Format: digits with a single '-' somewhere in the middle, at most 15 characters
// in total (e.g. 1234567-89012).

export const DELIVER_SAFELY_URL = 'https://nyc.gov/DeliverSafely';

export const COMPLETION_ID_MAX_LENGTH = 15;

const COMPLETION_ID_PATTERN = /^\d+-\d+$/;

/**
 * Clean up raw keyboard input as it is typed: drop anything that isn't a digit or a
 * hyphen, keep only the first hyphen, and cap the length.
 */
export const sanitizeCompletionId = (raw: string): string => {
  const cleaned = raw.replace(/[^\d-]/g, '');
  const dash = cleaned.indexOf('-');
  const oneDash = dash === -1
    ? cleaned
    : cleaned.slice(0, dash + 1) + cleaned.slice(dash + 1).replace(/-/g, '');
  return oneDash.slice(0, COMPLETION_ID_MAX_LENGTH);
};

/** True for digits-hyphen-digits, 15 characters or fewer. */
export const isValidCompletionId = (id: string | null | undefined): boolean =>
  !!id && id.length <= COMPLETION_ID_MAX_LENGTH && COMPLETION_ID_PATTERN.test(id);
