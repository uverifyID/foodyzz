// Worker ID label — Zebra 3.5" × 2.25". Printed by the rider from My Profile (Foodyzz)
// and by FoodyzzHQ as soon as it approves the rider's documents.
//
// KEEP IDENTICAL in foodyzz/src/services/workerLabel.ts and
// foodyzzhq/src/services/workerLabel.ts — both apps must print the same label.
//
//            Foodyzz
//         DELIVERY BIKES
//   ───────────────────────────
//   [selfie]  NAME
//             Worker ID 002
//             hello@foodyzz.com
//             https://foodyzz.com
//   8 Nursery Ct, Suite #1, … · (402) 203-9987   ← fine print
//
// Plain HTML handed to expo-print, so it goes through the phone's own print system
// (AirPrint on iOS, the Zebra print service on Android) to whatever printer the
// phone is already set up with. Thermal labels are black-only, so everything is
// pure black and the selfie is printed in greyscale. No app imports here — the
// builder stays renderable anywhere for previewing.

export const LABEL_CONTACT_EMAIL = 'hello@foodyzz.com';
export const LABEL_WEBSITE = 'https://foodyzz.com';
// Business address and phone — required on the badge, but printed as fine print.
export const LABEL_BUSINESS_ADDRESS = '8 Nursery Ct, Suite #1, Huntington, NY 11743';
export const LABEL_BUSINESS_PHONE = '(402) 203-9987';

// expo-print page size is in points (72 per inch): 3.5in wide × 2.25in tall.
export const LABEL_WIDTH_PT = 3.5 * 72;
export const LABEL_HEIGHT_PT = 2.25 * 72;

// The name is typed by the rider, so it is escaped before it goes into markup.
const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Step the name down in size as it gets longer so it always fits on two lines.
const nameSizeClass = (name: string): string =>
  name.length > 30 ? ' longer' : name.length > 20 ? ' long' : '';

export const buildWorkerLabelHtml = ({
  name,
  workerId,
  selfieDataUrl,
}: {
  name: string;
  workerId: string;
  selfieDataUrl?: string | null;
}): string => `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: 3.5in 2.25in; margin: 0; }
  html, body { margin: 0; padding: 0; }
  body { width: 3.5in; height: 2.25in; color: #000; background: #fff;
         font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; }
  .label { box-sizing: border-box; width: 3.5in; height: 2.25in; padding: 0.1in 0.15in; overflow: hidden; }
  .title { text-align: center; font-size: 24pt; font-weight: 900; line-height: 1; }
  .sub { text-align: center; font-size: 9pt; font-weight: 700; letter-spacing: 2.5pt; text-transform: uppercase;
         margin-top: 3pt; padding-bottom: 4pt; border-bottom: 1.5pt solid #000; }
  .row { display: flex; align-items: center; margin-top: 7pt; }
  .photo { box-sizing: border-box; flex: none; width: 1in; height: 1in; border: 1.5pt solid #000;
           object-fit: cover; filter: grayscale(1) contrast(1.15); }
  .info { margin-left: 0.14in; min-width: 0; }
  .name { font-size: 13pt; font-weight: 900; text-transform: uppercase; line-height: 1.1;
          overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  /* A long name drops a size (two sizes past 30 characters) and wraps onto a second
     line rather than being cut off — a worker ID has to carry the whole name. */
  .name.long { font-size: 10.5pt; }
  .name.longer { font-size: 9pt; }
  .wid { font-size: 10pt; font-weight: 700; margin-top: 3pt; }
  .wid span { font-family: Menlo, 'Courier New', monospace; font-weight: 900; }
  .contact { font-size: 8.5pt; line-height: 1.3; margin-top: 4pt; }
  /* Fine print: small enough to pass unnoticed, but still solid black — a thermal
     head dithers grey, which would make text this small unreadable. */
  .fine { text-align: center; font-size: 5.5pt; line-height: 1; margin-top: 5pt; white-space: nowrap; }
</style></head>
<body><div class="label">
  <div class="title">Foodyzz</div>
  <div class="sub">Delivery Bikes</div>
  <div class="row">
    ${selfieDataUrl ? `<img class="photo" src="${selfieDataUrl}" />` : '<div class="photo"></div>'}
    <div class="info">
      <div class="name${nameSizeClass(name || '')}">${escapeHtml(name || '')}</div>
      <div class="wid">Worker ID <span>${escapeHtml(workerId)}</span></div>
      <div class="contact">${LABEL_CONTACT_EMAIL}<br />${LABEL_WEBSITE}</div>
    </div>
  </div>
  <div class="fine">${LABEL_BUSINESS_ADDRESS} · ${LABEL_BUSINESS_PHONE}</div>
</div></body></html>`;

/**
 * Inline a remote image as a data: URL, so the print job never races the photo's
 * download (a remote <img> can print as a blank box).
 */
export const imageAsDataUrl = async (url: string): Promise<string> => {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

/**
 * iOS rejects printAsync when the print sheet is dismissed without printing
 * (expo-print's PrintIncompleteException). That is the user saying "not now", not
 * a failure, so callers stay quiet for it.
 */
export const isPrintCancelled = (e: any): boolean =>
  e?.code === 'ERR_PRINT_INCOMPLETE' || /did not complete/i.test(String(e?.message || ''));
