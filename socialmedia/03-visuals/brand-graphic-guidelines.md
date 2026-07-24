# UniHamper — Brand & Graphic Guidelines

> **Obeys** [`00-strategy/brand-source-of-truth.md`](../00-strategy/brand-source-of-truth.md) and
> [`00-strategy/content-pillars-calendar.md`](../00-strategy/content-pillars-calendar.md). Invent nothing.
> **Handles:** IG @unihamperhq · TikTok @unihamper · FB (page URL in SoT).
>
> ### ✅ Brand kit is CONFIRMED — see [`brand-kit.md`](./brand-kit.md)
> The logo, hex palette, and fonts are **locked** (verified from the codebase, 2026-07-09). §4 (Type),
> §5 (Color), and §6 (Logo) below now reflect the **real** kit — use them as final. Style is
> **neo-brutalist:** flat bold color blocks, hard `#0A0A0A` borders, chunky solid offset shadows
> (`6px 6px 0 #0A0A0A`, no blur), high contrast. **No gradients, soft shadows, or pastel washes.**
>
> **Real copy you may use verbatim (pulled from unihamper.com, 2026-07-09):**
> "Never do laundry *again.*" · "Uber, but for laundry" · "From hamper to folded, in six taps." ·
> "The convenience is the point. The fairness is the difference." · "Zero commission on your prices."
> **Do not fabricate** photos of specific real people, dorms, or laundromats. Use icons, illustration,
> mockups, or clearly permission-cleared real footage only (see SoT §8).

---

## 1. How to use this doc

Every static/carousel in the calendar can be built from the **6 templates in §7** using the grid (§3),
type scale (§4), placeholder palette (§5), and logo rules (§6). Each template is written so a non-designer
can build it in **Canva** (drag text into the named zones) or hand it to an **AI image tool** (paste the
"AI prompt" block). All dimensions are in pixels at 1× export.

---

## 2. Formats & when to use each

| Format | Pixels | Ratio | Use for |
|---|---|---|---|
| **Feed square** | 1080 × 1080 | 1:1 | IG feed statics, FB posts, simple stat cards |
| **Portrait feed** | 1080 × 1350 | 4:5 | IG feed (biggest feed real estate — **default for carousels**) |
| **Story / Reel cover** | 1080 × 1920 | 9:16 | IG/FB Stories, TikTok & Reel end-cards, countdown frames |

**Rule of thumb:** design the carousel at **1080 × 1350**; export a **1080 × 1920** variant of slide 1 for
Stories. Video lives in [`video-scripts.md`](./video-scripts.md); this file covers statics + video end-cards.

---

## 3. Layout grid & safe zones

**Master grid (all formats):** 12-column grid feel, but practically use a **margin + baseline** system:

- **Outer margin:** 80 px on 1080-wide art (never place text or logo closer than 80 px to any edge).
- **Baseline rhythm:** stack text blocks on a 24 px vertical rhythm (multiples of 24 for gaps).
- **Optical center:** headline sits slightly **above** true center (place the headline block's center at
  ~45% of height) — reads better in-thumb.

**Per-format safe zones (keep all critical text/logo/CTA inside these):**

| Format | Top safe | Bottom safe | Side safe | Why |
|---|---|---|---|---|
| 1080×1080 | 80 px | 80 px | 80 px | Simple; no platform UI overlaps a square feed post |
| 1080×1350 | 80 px | **220 px** | 80 px | IG crops the caption/username strip; keep CTA above the bottom 220 px |
| 1080×1920 | **250 px** | **320 px** | 80 px | Top: profile ring/close-X. Bottom: caption, "Send message", CTA sticker, TikTok right-rail |

**Story/Reel extra rule:** keep the **right 140 px** clear of text on 9:16 — that's where TikTok's
like/comment/share rail and IG's Story reactions sit.

**Carousel swipe affordance:** on multi-slide posts, put a small "→" or "1/5" dot indicator in the
**bottom-right inside the safe zone** on every slide so people know to swipe.

---

## 4. Type hierarchy

**Fonts are CONFIRMED** (free Google Fonts, available in Canva):

- **Display / headline:** **Space Grotesk** (bold, tight — confident, a little brutalist). Big, often
  all-caps or sentence-case.
- **Body / caption-on-graphic:** **Inter**.
- **Accent / numbers-that-pop:** Space Grotesk in its heaviest weight; never a script/handwriting font
  (keeps it modern, not cutesy).

**Type scale** (px at 1080-wide art; scale ~1.4× for 1920 tall art):

| Role | Size | Weight | Line height | Notes |
|---|---|---|---|---|
| Hero stat / huge number | 220–320 | Bold | 0.95 | e.g. "$9.99", "$0" — the whole point of a stat card |
| H1 headline | 96–120 | Bold | 1.0 | Max ~5 words |
| H2 / step title | 56–68 | SemiBold | 1.1 | Carousel slide titles |
| Body | 36–44 | Regular/Medium | 1.35 | Max ~14 words per line |
| Label / eyebrow / tag | 26–30 | SemiBold, letter-spaced +4%, UPPERCASE | 1.2 | "HOW IT WORKS", "FOR LAUNDROMATS" |
| Caption / handle / legal | 22–26 | Medium | 1.3 | @unihamperhq, "⚠️ CONFIRM" notes off-canvas |

**Type do's:** left-align or center consistently within a post; max 2 fonts; use weight (not color) for
most hierarchy; keep a huge number as the single hero element.
**Type don'ts:** no more than ~7 words in a headline; no all-caps body paragraphs; no drop shadows unless
placing text over a photo (then use a subtle scrim, see §8).

---

## 5. Color palette (CONFIRMED)

> These are the **real** brand colors (from [`brand-kit.md`](./brand-kit.md)). Neo-brutalist: flat blocks,
> hard `#0A0A0A` borders, solid offset shadows — **no gradients or soft shadows.**

| Token | Hex | Role |
|---|---|---|
| `--brand` (brand orange) | `#FF4D00` | Primary CTA/hero accent — the ONE thing you want tapped (punchy + sparing) |
| `--logo-orange` | `#F07830` | Softer orange fills; matches the logo |
| `--ink` | `#0A0A0A` | All borders, body text, shadows |
| `--paper` | `#FFFFFF` | Backgrounds |
| `--yellow` | `#F7F75C` | Provider/laundromat cards, hero highlight, ticker |
| `--blue` | `#AEBEF2` | Customer/student cards |
| `--pink` | `#F2A7A0` | "Built for college life" tags |
| `--light-orange` | `#FFB866` | Ticker + tagline highlights |
| `--silver` | `#B4BCC8` | Secondary card fills |

**Shadows (neo-brutalist):** `6px 6px 0 0 #0A0A0A` (default), `4px 4px 0 0 #0A0A0A` (small),
`8px 8px 0 0 #0A0A0A` (large). Always solid black, never blurred.

**Audience color-coding (keep consistent so each audience learns its color):** students → **blue
`#AEBEF2`**, laundromats → **yellow `#F7F75C`**, ambassadors → **orange `#FF4D00` / `#FFB866`**.

**Usage:** every card/button gets a hard `#0A0A0A` border + a solid offset shadow. One bold accent per
graphic — **orange is the spice reserved for the CTA**, not a base. Neutrals (`--paper`/`--ink`) do the
heavy lifting; the audience accent (blue/yellow/orange) blocks the card.

> **Note on the templates in §7:** their AI-prompt blocks still name the old placeholder hexes/fonts
> (e.g. `#3B6CF6` blue, `#FF7A45` orange, `#F7F8FA`, `#DCE6FF`, "Poppins") and gradients. When you build
> or generate them, **substitute the confirmed palette above + fonts (§4)** and the neo-brutalist style
> (flat blocks, black borders, offset shadows — no gradients). Map: old `--brand` blue → **orange
> `#FF4D00`** for CTAs, old `--accent` orange → **`#FF4D00`/`#FFB866`**, old `--mint`/`--cloud` → a real
> accent block (`--blue`/`--yellow`/`--silver`).

---

## 6. Logo & assets (CONFIRMED)

Real files live in the repo — grab them directly, don't rebuild a wordmark:

| Asset | Path | Use |
|---|---|---|
| Wordmark logo | `mktweb/public/unihamper-logo.png` | Headers, post footers, video end-cards |
| App icon | `mktweb/public/unihamper-icon.png` | Profile pics, stamps, favicons |

**Placement rules:**

- **Position:** top-left **or** bottom-center, inside the safe margin (80 px). Pick one per campaign and
  stay consistent.
- **Clear space:** keep empty space equal to the height of the "U" on all sides of the logo.
- **Min size:** wordmark ≥ 180 px wide on 1080 art (≥ 220 px on 1920) so it's legible in-thumb.
- **On busy/photo backgrounds:** place the logo on `--paper` or a solid accent block with the standard
  black border — never the full-color logo over a photo without a scrim.
- **One logo per graphic.** Carousels: logo on slide 1 and the final CTA slide only, not every slide.
- **Never** stretch, rotate, recolor the wordmark, add effects, or box the logo in a shape it wasn't
  designed for.

**Handle stamp:** every graphic carries `@unihamperhq` (or `@unihamper` for TikTok exports) as a small
Label-size mark near the logo or bottom edge — this is our watermark for reposts.

---

## 7. Reusable post templates

> Each template: purpose, format, exact layout (zones by position), sample on-graphic copy (all
> SoT-compliant), and an **AI prompt** block for image tools. Swap `⚠️ CONFIRM` bits before publishing.
> Colors reference §5 tokens; fonts reference §4.

### Template A — "Big-Stat Card"  ·  Pillar P5/P1  ·  1080×1080 (or 1350)

**Purpose:** one number does all the work. The `$9.99`, `$0`, `$0.00` differentiators.

**Layout (top → bottom):**
1. **Eyebrow** (Label, top-left inside margin): `THE UNIHAMPER DIFFERENCE`
2. **Hero number** (220–320px, centered ~45% height, `--accent` on `--paper`): `$9.99`
3. **Qualifier line** (H2 under the number, `--ink`): `flat. pickup + delivery. paid to your driver.`
4. **Footer strip** (bottom, inside safe zone): logo top-left convention OR bottom-center + `@unihamperhq`.

**Sample copy variants (rotate):**
- `$0` · "until your wash starts. It's a hold, not a charge."
- `$0.00` · "commission to laundromats. You keep your full rate." (P4)
- `$9.99` · "flat pickup + delivery. That's the whole fee."

**AI prompt:** *"Minimalist social graphic, 1:1. Warm off-white (#F7F8FA) background. One giant bold number
'$9.99' in warm orange (#FF7A45), Poppins-style geometric sans, centered slightly above middle. Small
uppercase eyebrow 'THE UNIHAMPER DIFFERENCE' top-left in dark navy. One short caption line beneath the
number in dark navy. Generous whitespace, no photos, modern, flat, high contrast, student-friendly."*

---

### Template B — "How-It-Works 3-Step"  ·  Pillar P1  ·  1080×1350 (single) or 4-slide carousel

**Purpose:** the pickup → tracked → folded → delivered magic. Mirrors site's "six taps" idea.

**Layout — single-frame version (vertical stack, 3 equal rows):**
- **Header band** (top, `--brand` fill, `--paper` text): `HOW UNIHAMPER WORKS`
- **Row 1:** big numeral `1` in `--accent` + icon (phone) + text `Request a pickup — right from your dorm.`
- **Row 2:** `2` + icon (map pin/route) + `Track it live. Chat your provider anytime.`
- **Row 3:** `3` + icon (folded stack) + `Folded & delivered. You never touched a machine.`
- **CTA footer:** `$0 until your wash starts · $9.99 flat delivery` + logo + handle.

**Carousel version (1080×1350 ×4):** Slide 1 = title "From hamper to folded, in six taps." (real site copy);
Slides 2–4 = one step each, big numeral + icon + one line; add "→" indicator bottom-right; final line on
slide 4 = CTA "Request a pickup at unihamper.com".

**AI prompt (per step icon):** *"Simple flat line-icon on soft blue (#DCE6FF) rounded square, 2px stroke in
dark navy: [a phone / a route with a pin / a folded laundry stack]. Minimal, modern, single color, no
background clutter."*

---

### Template C — "Tip Carousel"  ·  Pillar P2  ·  1080×1350, 5–7 slides

**Purpose:** value-first dorm-laundry tips (reach/SEO), light branding, soft CTA at the end.

**Layout (consistent across slides):**
- **Slide 1 (cover):** eyebrow `DORM LAUNDRY 101` + H1 hook `5 laundry mistakes every freshman makes` +
  small "swipe →". Logo top-left.
- **Slides 2–6 (one tip each):** big tip number top-left (`--brand`), H2 tip title, 1–2 body lines. Keep
  the same layout every slide (only text changes) so it feels like a set.
- **Final slide (CTA):** `Or skip laundry entirely.` + `UniHamper: request a pickup, get it folded &
  delivered.` + `$9.99 flat · $0 until wash starts` + logo + handle + `@unihamperhq`.

**Sample tips (all generic/verifiable, no invented stats):** "Sort by color AND weight." · "Cold water =
less shrinking + fading." · "Don't overload — clothes need room to move." · "Zip zippers, unbutton
buttons." · "Clean the lint trap every time (it's a fire thing)." · "Fold straight out of the dryer to
skip ironing."

> ⚠️ Do **not** add a stat like "saves X hours" unless it carries a cited external source (SoT §8).

**AI prompt:** *"Clean 4:5 carousel slide, off-white background, big navy number '01' top-left, bold
Poppins-style title, two lines of body text below in Inter, lots of whitespace, tiny 🧺 wordmark top-right,
consistent template for a set of slides."*

---

### Template D — "Testimonial Frame"  ·  Pillar P1/P6  ·  1080×1080 or 1350  ·  ⚠️ CONFIRM real quote

**Purpose:** social proof. **BLOCKED until a real, permission-cleared quote exists** (SoT §8: no invented
testimonials).

**Layout:**
- **Big quote mark** `“` in `--cloud`, top-left as a design element.
- **Quote** (H2, `--ink`, centered): `⚠️ CONFIRM — real customer quote here`
- **Attribution** (Label): `— ⚠️ CONFIRM real first name + role, e.g. "Maya, sophomore"` (first name only,
  with consent).
- **Optional 5-star row** in `--accent`.
- Logo + handle footer.

**Guardrail:** never ship this with placeholder Lorem or a made-up name/photo. If no real quote, use
Template A/B instead. When a real quote lands, keep the person's likeness out unless separately consented.

**AI prompt:** *(only after real quote confirmed)* *"Soft off-white testimonial card, large light-blue
quotation mark, centered bold quote in navy, small attribution line, five orange stars, minimal, modern."*

---

### Template E — "Ambassador Earnings Card"  ·  Pillar P3  ·  1080×1350

**Purpose:** recruit ambassadors (the growth engine). Ambassador color = **orange** (§5).

**Layout:**
- **Eyebrow:** `CAMPUS AMBASSADOR`
- **Hook (H1):** `Get paid, don't just pay.`
- **Earnings chip** (a rounded orange `--brand` pill, centered, big): `30% of UniHamper's commission` — the
  confirmed phrasing. **Never** write "30% of every order" or a bare "30%" (implies 30% of order value —
  false, SoT §5a). No hard per-order **$** figure until Raj OKs it.
- **3 bullets** (Body, with check icons): `Flexible around class` · `Remote-friendly` · `Recruit
  students + local laundromats`
- **CTA footer:** `DM "ambassador" to @unihamperhq` (fallback until the real signup URL is confirmed — SoT §9).
- Logo + handle.

**AI prompt:** *"Energetic 4:5 neo-brutalist recruitment card, a solid orange (#FF4D00) block on white with
a hard #0A0A0A border and 6px solid offset black shadow, bold ink headline 'Get paid, don't just pay.', a
rounded pill in the center reading '30% of UniHamper's commission', three ink bullet lines with small check
marks, clean modern student vibe, UniHamper wordmark top-left."*

---

### Template F — "Laundromat Partner Card"  ·  Pillar P4  ·  1080×1080 or 1350

**Purpose:** recruit supply (laundromats). The `$0.00 commission` story.

**Layout (split or stacked):**
- **Eyebrow:** `FOR LAUNDROMATS NEAR CAMPUS`
- **Hero stat:** `$0.00` (huge, `--accent`) + qualifier `commission. You keep your full rate.`
- **3 proof bullets** (mint checks): `You set your own prices` · `Free to list — no monthly fee` ·
  `Stripe payouts (twice monthly, or daily for $0.99)`
- **CTA:** `List your laundromat at unihamper.com`
- Logo + handle.

> Never quote a specific $/lb (SoT §5) — providers set their own prices.

**AI prompt:** *"Trustworthy 1:1 B2B graphic, off-white background, giant orange '$0.00' with 'commission'
label, three navy bullet lines with mint check marks, small storefront/laundromat line-icon, clean modern,
professional but friendly, 🧺 wordmark bottom-center."*

---

## 8. Working with photos & real imagery

- **Only** real imagery we're licensed for (SoT §9 "real photo library" is still open ⚠️ CONFIRM) or clearly
  permission-cleared UGC/owner spotlights. **No stock photos of specific 'real people' presented as
  customers.** Generic hands/clothes/machines from a licensed library are fine as texture.
- Over any photo, place text on a **scrim**: a 40–60% `--ink` gradient from the text edge, or a solid
  rounded card, so contrast stays legible.
- **Never fabricate** a photo of a specific real dorm, campus, or a named laundromat. Illustration/icon or a
  neutral mockup instead, and flag if a real photo is truly needed.

---

## 9. Export & file naming

- Export at **1× PNG** (statics) or **JPG 90%** (photo-heavy). Video covers as PNG.
- Name: `YYYY-MM-DD_pillar_format_short-desc.png` e.g. `2026-08-01_P1_1350_how-it-works.png`.
- Keep an editable Canva master per template so a brand-kit swap is one edit, not a rebuild.

---

## 10. Pre-publish checklist (every graphic)

- [ ] Passes brand-source-of-truth — no invented facts/prices/campuses/stats/testimonials
- [ ] No specific wash $/lb quoted ("prices set by your local pro")
- [ ] All text inside the format's safe zone (§3); nothing under the caption/right-rail strip
- [ ] One hero element; ≤2 fonts; ≤1 accent color; contrast pairing from §5
- [ ] Logo + `@unihamperhq` (or `@unihamper`) watermark present, inside margin
- [ ] Every `⚠️ CONFIRM` slot (ambassador %, campus, URL, real quote) resolved or left as a visible blank —
      never a guessed value
- [ ] Real CTA present (Request a pickup / List your laundromat / Become an ambassador)

---

## ⚠️ CONFIRM items introduced by this doc
- [x] **Brand kit** — CONFIRMED (real logo files, hex palette, fonts). See [`brand-kit.md`](./brand-kit.md); §4–§6 now reflect it.
- [x] **Ambassador commission** — CONFIRMED: **30% of UniHamper's commission** per campus order (Template E). Still open: **signup URL** (`⚠️ CONFIRM`) and any hard per-order **$** figure.
- [ ] **Launch campus list** — any geo text on a graphic (SoT §9)
- [ ] **Real permission-cleared quote/photo** — Template D is blocked without it (SoT §8/§9)
- [ ] **Licensed photo library** — §8 real-imagery rule depends on it (SoT §9)
