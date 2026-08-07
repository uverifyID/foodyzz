# Visual Brand Kit

> Extracted from the live site and the app configs, not invented. Source: `website/css/style.css:10-24`, `tailwind.config.js`, `foodyzz/tailwind.config.js`.

---

## Colour

| Token | Hex | Rule |
|---|---|---|
| Brand green | **#86B54F** | **Fill only.** Always black text on it — 8.7:1. White on this green is 2.4:1 and fails accessibility. |
| Green mid | #658F32 | Secondary fill, hover states |
| Green dark | **#507425** | **Green text on white** — 5.4:1. This is the only green you may set type in. |
| Green ink | #2B4011 | Deep accents, borders |
| Green tint | #EFF5E6 | Backgrounds, quiet panels |
| Black | #0A0A0A | Type, keylines, shadows |
| Paper | #FAFAF7 | Warm off-white page background |
| Stone | #F0EFEA | Panel fill |
| Stone mid | #A8A29E | Borders, dividers |
| Stone text | #57534E | Secondary type |

**The one rule people break:** `#86B54F` is a *fill*. The moment someone sets white type on it, the design is broken and inaccessible. If you need green text, use `#507425` on white.

### Colours in shipped assets that are NOT brand

Two exist and both should be corrected rather than matched:

- **#7B8F76** — the sage-green backdrop on the app-store screenshots. In no config anywhere.
- **~#4F3FD9** — the indigo/violet home banner in the app, with blue price text. Visibly off-system against the green identity.

Social creative uses the green system. Do not colour-match the screenshots.

---

## Type

| Role | Family | Weights |
|---|---|---|
| Display / headings | **Space Grotesk** | 500, 700 |
| Body | **Inter** | 400, 600, 700 |
| Numbers, labels, kickers | **JetBrains Mono** | 400, 700 |

**Set every price in JetBrains Mono.** Monospaced figures are the visual signature of the price-transparency position — they read as a receipt, not a promotion. `$887.68` in mono says something different from `$887.68` in a display face, and the difference is exactly the brand.

⚠️ `assets/fonts/` contains **Space Mono**, which is neither Space Grotesk nor JetBrains Mono. Orphaned. Don't use it.

---

## Style signature — neubrutalism

The site has a specific, consistent look and social creative should extend it rather than invent a second visual language:

- **Hard offset shadows, zero blur** — `6px 6px 0 0 #0A0A0A` (large), `4px 4px 0 0` (small)
- **14px corner radius**
- **Heavy black keylines** on every panel
- **Flat fills, no gradients, no glow**
- Generous whitespace on `#FAFAF7`

This style photographs and screenshots well, survives compression, and reads at thumbnail size. It's a good fit for social. Keep it.

---

## Logo

`website/assets/foodyzz-wordmark.png` — 512×512, lowercase green wordmark, transparent background.

### ⚠️ There is no logomark, and it is a launch blocker

`foodyzz-icon.png` is **byte-identical** to the wordmark. That means the favicon, the Apple touch icon, the schema.org `logo`, and the OG image are all a wide wordmark squeezed into a square with enormous dead space. It's why `twitter:card` was downgraded to `summary`, and why the nav CSS carries a `--nav-height: 168px` hack for a 136px logo.

**A profile picture for Instagram, Facebook and TikTok cannot be made from this asset.** At 32–64px the wordmark is illegible.

**Minimum viable fix, achievable in an hour:** the lowercase **"f"** from the wordmark, set in the brand green on black, or black on brand green, on a square canvas with proper optical padding. It only has to work at 32px. Also produce an SVG — there is currently no vector logo anywhere in the repo.

See `../OPEN-QUESTIONS.md` Q9.

---

## Iconography

The website uses **emoji as icons** — 🚚 💳 🏁 💬 🔔 ⭐ 📍 🔒 ⚖️. There's no icon font and no SVG sprite. The app uses `lucide-react-native`.

**Recommendation for social:** use **Lucide** icons throughout, matching the app, drawn as 2px black strokes to sit inside the neubrutalist system. Emoji in a designed graphic reads as unfinished; emoji in a caption is fine.

---

## Photography direction

**What exists:** one real photograph of the Foodyzz bike — black step-over frame, red rims, disc brakes, integrated down-tube battery, **green "foodyzz" decal on the frame and battery** — baked into `appstore/foodyzz/ios/screenshot-3.png` and served at runtime from Firebase Storage. Model `imageUrl` fields in config are empty strings.

**What does not exist:** any rider, any street, any delivery scene, any bike-in-context shot, any team photo. Zero marketing-usable photographs on disk.

**Direction when shooting** (full brief in [shot-list.md](shot-list.md)):
- Real riders, real streets, real weather. No studio.
- Golden hour or overcast. Avoid harsh midday.
- Shoot the bike *at work* — locked outside a restaurant, at a light, mid-handover.
- **Every rider on camera wears a helmet.** No exceptions, ever.
- Shoot 9:16 vertical first, 1:1 second, 16:9 last. Social is the primary consumer.
- No stock photography. No AI-generated bikes or people. This audience spots both instantly and it costs the entire trust position.

---

## Assets that must never appear in Foodyzz marketing

| Path | What it is |
|---|---|
| `assets/images/unclesam.png` | Stock Uncle Sam clipart. Unrelated. Also duplicated in `foodyzzhq/`. |
| `foodyzzhq/assets/images/newinstall/p1-p6.png` | **UniHamper laundromat illustrations** — a different company's artwork, still shipping inside the Foodyzz HQ app |
| Anything in `htmlweb/` | UniHamper (laundry) brand |
| Anything in `Mktweb/` | UniHamper brand, including `unihamper-logo.png` and an orange palette |
| App-store screenshots as-is | Show `"NO PROMOTIONS AVAILABLE NEARBY"` and `"SERVICE HISTORY (0)"` — honest but weak. Reshoot with seeded demo data. |
| The test persona **"JOSEPH BUFFET" / +1 202 555 0123** | 555 test data from the HQ screenshots |

---

## Export specs

| Use | Size | Format |
|---|---|---|
| IG feed square | 1080×1080 | JPG, sRGB |
| IG portrait / carousel | 1080×1350 | JPG |
| IG Story / Reel / TikTok | 1080×1920 | MP4 H.264 |
| FB link preview / OG | 1200×630 | JPG |
| Profile picture | 512×512 | PNG, transparent-safe |
| Blog hero | 1600×900 | WebP with JPG fallback |

**Safe areas:** keep type out of the bottom 250px on TikTok (UI chrome) and the top/bottom 150px on Stories.
