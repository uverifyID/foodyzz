# Foodyzz print assets

Built 2026-09-09 from the three logo files in `../` and the numbers in
`socialmedia/01-strategy/brand-source-of-truth.md`.

## What's here

| File | Piece | Trim | Bleed page |
|---|---|---|---|
| `pdf/card-front-1-ink.pdf` | Business card front — black field, `foodyzz1` logo in green | 3.5 × 2 in | 3.75 × 2.25 in |
| `pdf/card-front-1-white.pdf` | Business card front — white field, `foodyzz1` logo as supplied | 3.5 × 2 in | 3.75 × 2.25 in |
| `pdf/card-front-2-green.pdf` | Business card front — green field, `foodyzz2` logo knocked to black | 3.5 × 2 in | 3.75 × 2.25 in |
| `pdf/card-front-2-white.pdf` | Business card front — white field, `foodyzz2` logo as supplied | 3.5 × 2 in | 3.75 × 2.25 in |
| `pdf/card-front-3-paper.pdf` | Business card front — tint field, `foodyzz3` 3D render | 3.5 × 2 in | 3.75 × 2.25 in |
| `pdf/card-back.pdf` | **Shared back** — QR, contact, UL line. Pairs with all five fronts. | 3.5 × 2 in | 3.75 × 2.25 in |
| `pdf/rack-4x6.pdf` | 4 × 6 price card | 4 × 6 in | 4.25 × 6.25 in |
| `pdf/foodyzz-print-pack.pdf` | All of the above as one flip-through proof | — | — |
| `png/*.png` | 300 dpi rasters of the same pages, for web/preview use | — | — |
| `src/*.html` | Self-contained sources — fonts and images embedded, no network needed | — | — |
| `src/build.py` | Regenerates every HTML from the logo files | — | — |
| `foodyzz-logomark-square.png` | Bonus: the rider-in-disc glyph cut out of `foodyzz1`, as a square mark | — | — |

## Sending to a printer

The PDFs are already at **trim + 0.125 in bleed on every edge**, which is what
almost every printer asks for. Tell them:

- Business cards: trim 3.5 × 2 in, 0.125 in bleed, **double-sided** — pick one front, back is shared.
  The two `-white` fronts and the 4 × 6 need no flood coat on the light areas, so they run cheaper.
- 4 × 6 card: trim 4 × 6 in, 0.125 in bleed, single- or double-sided.
- Colour: built in RGB. A printer will convert to CMYK. The brand green `#86B54F`
  converts to roughly **C50 M12 Y89 K0**; ask for a proof if the green matters.
- Do not add crop marks yourself — the printer imposes them.

Stock suggestion: 16 pt uncoated or soft-touch. The black card (front 1) shows
fingerprints on gloss; matte or soft-touch is worth the upcharge on that one.

## The QR code

Encodes **https://foodyzz.com/app** — a redirect page on the live site that reads
the visitor's device and forwards it to the right store:

- iPhone / iPad → `apps.apple.com/us/app/foodyzz/id6794564474`
- Android → `play.google.com/store/apps/details?id=com.foodyzz`
- Desktop, or anything unrecognised → stays on the page and shows both badges
- Crawlers and link-preview bots → never redirected, so shares stay sane

iPadOS 13+ reports a Mac user-agent, so the page uses `maxTouchPoints` to tell an
iPad from a desktop Mac — a real Mac must not be thrown at the iOS store. The
logic is covered by `website/` deploy checks and was unit-tested against twelve
real user-agent strings before shipping.

Error correction level H (30% recoverable), so it still scans through a scuff.
Module sizes as built: **0.72 mm** on the business card, **0.58 mm** on the 4 × 6 —
both above the ~0.5 mm floor for phone cameras, and both decode-tested against
the rendered 300 dpi output. **If you resize the QR, do not go below 0.6 in
square on the card** or the modules drop under the floor.

Same code is on the website in two places: the Get-the-App band on the home page
and the `/app` page itself (both desktop-only — a phone scanning its own screen
is pointless). Source assets: `website/assets/foodyzz-app-qr.{png,svg}`.

To change the destination, edit `website/app.html` — the print QR keeps pointing
at `/app`, so **the cards never need reprinting when a store URL changes.** That
indirection is the whole reason the QR does not point at a store directly.

## Design system

Straight from the brand kit — green `#86B54F` as a fill that always carries black
ink, `#507425` for green text on white, ink `#0A0A0A`, paper `#FAFAF7`, tint
`#EFF5E6`. Space Grotesk for display, Inter for body, JetBrains Mono for the
labels and kickers.

The device that ties the cards into a set is the **full-bleed foot band**: green
on the light and ink cards, ink on the green card, always with a single tracked
mono line. The back reuses it for the UL certification claim.

On any white or tint field the kicker uses `#507425`, not the `#86B54F` fill
tone — the fill green is only 2.4:1 on white and fails contrast as text.

## Copy rules honoured

- "Rent to Buy", never "rent-to-own".
- "Certified to UL 2849 by TÜV Rheinland" — never "UL Listed" or "Foodyzz is certified".
- "Motor assist to 15 mph", no top-speed figure.
- Manhattan, not "NYC-wide" or "five boroughs", for the service area.
- Deposit is **charged** at delivery and refunded on return, never "held".
- No mention of the Protection Plan, so no waiver disclosure is required on these pieces.
- **No phone number.** Support is in-app chat; `hello@foodyzz.com` is the only
  contact printed. If a number is ever added back, it has to exist on the site
  and in the Terms too, or the card contradicts them.

## Re-verify before reprinting

Prices live in the Firestore doc `apiConfig/logistics` and admins can change them
without a deploy. As printed, verified **2026-09-09**:

| | Printed | Made of |
|---|---|---|
| Rent | **$22.49 / week** | base rate; $9.99 maintenance once per period, disclosed on the tier |
| Rent to Buy | **$83.25 / month** | $73.26 plan + $9.99 maintenance — the all-in figure, not the base |
| Buy | **$999** | cash price |

### The 0% interest claim is exact to the cent — treat it as fragile

12 x $83.25 = **$999.00**, level with the **$999.00** cash price. Because the two
are identical there is no finance charge, so **"Same as the cash price — 0%
interest"** is accurate and printable.

Move **any** of these and the claim breaks:

- raise the rent-to-buy rate or the maintenance fee -> total exceeds the cash
  price, and New York bars the interest-free claim;
- **lower the buy price** -> same outcome. This is not hypothetical: buy was
  briefly set to $879 on 2026-09-09, which put the monthly route $120 above cash
  and forced the claim off the card. It came back only when buy returned to $999.

The app recomputes and stops showing the claim automatically. **Printed cards
cannot.** So before any reprint, redo this one line of arithmetic:

    rent_to_buy_base + maintenance) x 12  ==  buy_price      ->  0% may be printed
                                          !=  buy_price      ->  it may not

`src/build.py` asserts this at build time and will refuse to produce the 4 x 6 if
it stops holding.

### Rent shows the base rate, Rent to Buy shows all-in

Deliberate, not an oversight. Rent's $9.99 is charged **once per rental period**,
so on the 4-week minimum it moves the effective weekly rate by about $2.50 and is
disclosed on the tier. Rent to Buy's $9.99 recurs **every month**, so leaving it
out would misstate what a customer pays — and the all-in figure is what makes the
$999 tie, and therefore the 0% claim, legible.

### Known drift to fix in code

`foodyzz/src/services/logistics.ts:29` (mirrored in `foodyzzhq/` and
`functions/scripts/seed-logistics.js`) still carries the fallback
`{ rent: 22.49, buy: 899, rentToBuy: 69.99 }`. That is the value used when the
Firestore config cannot be read, and it disagrees with both the live config and
this card — a fallback that quietly prices the bike at $899 with a $69.99 plan.
