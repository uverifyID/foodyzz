# UniHamper Brand Kit (VERIFIED — real assets, not placeholders)

Pulled from the actual codebase on 2026-07-09. Source: `mktweb/tailwind.config.ts`,
`mktweb/src/app/layout.tsx`, and the logo assets. **Use these everywhere** — the earlier
"⚠️ CONFIRM brand kit" placeholders in `brand-graphic-guidelines.md` are now superseded by this file.

## Style
**Neo-brutalist.** Flat bold color blocks, hard `#0A0A0A` outlines, chunky offset drop-shadows
(no blur), high contrast, confident sans-serif type. Playful but clean. Think: bold poster, not gradient app.

## Colors
| Role | Name | Hex | Use |
|---|---|---|---|
| **Primary brand** | brand orange | `#FF4D00` | Hero accents, primary buttons/CTAs, key highlights (use sparingly + punchy) |
| **Logo orange** | logo-orange | `#F07830` | Warm orange matching the logo; softer orange fills |
| **Ink** | ink | `#0A0A0A` | All borders, body text, shadows |
| **Paper** | paper | `#FFFFFF` | Backgrounds |
| Accent | yellow | `#F7F75C` | Hero highlight, provider/laundromat cards, ticker |
| Accent | blue | `#AEBEF2` | Customer/student cards |
| Accent | pink | `#F2A7A0` | "Built for college life" tags |
| Accent | light-orange | `#FFB866` | Ticker + tagline highlights |
| Accent | silver | `#B4BCC8` | Secondary card fills |

**Shadows (neo-brutalist):** `6px 6px 0 0 #0A0A0A` (default), `4px 4px 0 0 #0A0A0A` (small),
`8px 8px 0 0 #0A0A0A` (large). Always solid black, never blurred.

**Audience color-coding (handy for posts):** students → **blue `#AEBEF2`**, laundromats → **yellow
`#F7F75C`**, ambassadors → **orange `#FF4D00`/`#FFB866`**. Keep it consistent so each audience learns its color.

## Type
- **Headlines / display:** **Space Grotesk** (bold, tight). Big, confident, often all-caps or sentence-case.
- **Body / UI:** **Inter**.
- Both are free Google Fonts (already used on the site), so Canva/CapCut/AI tools can match them.

## Logo & icon assets (real files in repo)
| Asset | Path | Use |
|---|---|---|
| Wordmark logo | `mktweb/public/unihamper-logo.png` | Headers, post footers, video end-cards |
| App icon | `mktweb/public/unihamper-icon.png` | Profile pics, stamps, favicons |
| 512 icon | `htmlweb/icon-512.png` | High-res icon |
| Apple touch icon | `htmlweb/apple-touch-icon.png` | — |
| Splash | `scrubs/assets/images/logo/mainpage/splashscreen.png` | App splash reference |

> Grab these directly from the repo for any graphic/video. Do not recolor the logo; place it on
> paper or a solid accent block with the standard black border.

## Voice (pairs with visuals)
Friendly, student-native, a little cheeky, genuinely helpful. Short lines. The visual is loud; the copy is warm.

## Do / Don't
- ✅ Hard black borders on cards/buttons; solid offset shadows; one bold accent per graphic.
- ✅ Orange for the ONE thing you want tapped (the CTA). Don't rainbow every element.
- ✅ Keep the logo on paper or a single accent block, black-outlined.
- ❌ No gradients, soft shadows, drop-blurs, or pastel washes — that's off-brand.
- ❌ Don't invent a new logo lockup or recolor the wordmark.

## Known inconsistency to reconcile (not a blocker)
`htmlweb/index.html` still declares `theme-color=#3B4FE0` (blue) and a blue-leaning OG image, predating
the orange neo-brutalist brand. Align the static site's `theme-color` + OG image to `#FF4D00` when
convenient. ⚠️ CONFIRM which is canonical (assuming the mktweb orange system is).
