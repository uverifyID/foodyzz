# Graphic Templates — Per-Post Visual Briefs

> Eight reusable templates. Build each once in Canva or Figma, then the whole caption library becomes a fill-in-the-blanks job. Every template uses the neubrutalist system from [brand-kit.md](brand-kit.md): flat fills, `4px 4px 0` hard black shadows, 14px radius, heavy black keylines.

---

## T1 — The Number

**Use for:** C01, C04, C09, and every price claim.

```
┌──────────────────────────────────┐
│  ▸ FOODYZZ            [kicker]   │  JetBrains Mono 700, 24pt, black
│                                  │
│                                  │
│      $887.68                     │  JetBrains Mono 700, 180pt, black
│                                  │  on #86B54F full-bleed fill
│      Then the bike is yours.     │  Space Grotesk 500, 44pt, black
│                                  │
│                                  │
│  Model 1 · 8 months · $110.96/mo │  Inter 400, 22pt, black
└──────────────────────────────────┘
     ↳ 6px 6px 0 #0A0A0A on the whole card
```

**Rules:** one number per graphic. Black on green, never white on green. The qualifier line is mandatory — a number without its condition is the thing we're positioning against.

---

## T2 — The Receipt

**Use for:** C08 (the flagship), C11, C24.

Styled as an actual receipt on `#FAFAF7` with a dashed black rule between sections. **JetBrains Mono throughout** — the monospace is doing the persuasion.

```
┌──────────────────────────────────┐
│  FOODYZZ · MODEL 1 · 4 WEEKS     │
│  ────────────────────────────    │
│  Bike  $19.99 × 4 ....... 79.96  │
│  Maintenance ............. 5.99  │
│  GPS tracker ............. 4.99  │
│  Insurance ............... 9.99  │
│  ────────────────────────────    │
│  AT DELIVERY ........... 100.93  │  ← green highlight bar
│  + sales tax & card fee          │
│                                  │
│  Deposit ............... 100.00  │
│  Separate charge. Refunded at    │
│  return, minus damage.           │
└──────────────────────────────────┘
```

**Rule:** dollar figures right-aligned on the decimal. Leader dots. It should look like something a machine printed, not something a designer made.

---

## T3 — The Comparison

**Use for:** C03, C30, blog #15.

Two or three columns, black keylines, brand green fill on the Foodyzz column **only as a background tint (`#EFF5E6`)** — never as a "winner" badge.

```
┌───────────┬───────────┬───────────┐
│   RENT    │RENT TO BUY│    BUY    │
├───────────┼───────────┼───────────┤
│ $100.93   │ $110.96   │   $799    │
│ /4 weeks  │ /month    │   once    │
├───────────┼───────────┼───────────┤
│ New/used  │ New       │ New       │
│ Deposit ✓ │ Deposit ✓ │ None      │
│ Docs ✓    │ Docs ✓    │ None      │
│ Own it ✗  │ 8 months  │ Day one   │
└───────────┴───────────┴───────────┘
```

**The rule that makes this template work:** include a row where Foodyzz loses. On any competitor comparison, "Battery swaps" reads ✗ for us and ✓ for Whizz and JOCO. Ship it that way. A comparison table with no losing rows is read — correctly — as an advertisement.

---

## T4 — The Statistic

**Use for:** C16, C17, C19, and any sourced NYC number.

```
┌──────────────────────────────────┐
│                                  │
│   27,000+                        │  JetBrains Mono 700, 140pt
│   motorized vehicles seized      │  Space Grotesk 500, 36pt
│   in NYC in 2024                 │
│                                  │
│   ─────────────────────────      │
│   Source: NYC Comptroller,       │  Inter 400, 18pt, #57534E
│   Street Safety in the Era of    │
│   Micromobility                  │
└──────────────────────────────────┘
```

**Non-negotiable:** the source is on the graphic itself, not only in the caption. Screenshots get shared without captions, and an unsourced statistic in circulation is a liability.

---

## T5 — The Spec Card

**Use for:** C07, product posts.

Photo of the bike, ~60% of frame, with spec callouts on black-keylined tags pointing to real parts. The annotated parts diagram in `appstore/foodyzz/ios/screenshot-3.png` is a ready-made storyboard — it already labels 26 components.

Specs: `Class 2 · motor assist to 20 mph` · `Throttle included` · `Up to 50 mi / charge, eco + pedal assist` · `Removable battery` · `IP65` · `300 lbs rider + cargo` · `UL 2849` · `UL 2271` · `Tested by TÜV Rheinland`

**Three rules on this card:**
- The range figure always carries "eco mode, pedal assist" in the same tag. Never a bare "50 miles."
- The 300 lb figure always carries "rider + cargo." Never a bare "300 lbs."
- Never print "21 mph" — it conflicts with the Class 2 claim. See `../OPEN-QUESTIONS.md` Q4b.

---

## T6 — The Rule Card

**Use for:** C15, C25, C27, all rules content.

`#0A0A0A` background, green and white type. Deliberately different from the commercial templates so rules content reads as information, not promotion.

```
┌──────────────────────────────────┐  black bg
│  NYC RULE · EFFECTIVE OCT 2025   │  Mono 700, 20pt, #86B54F
│                                  │
│  15 mph.                         │  Space Grotesk 700, 120pt, white
│  Every e-bike.                   │
│  Every class.                    │
│                                  │
│  Streets · bike lanes ·          │  Inter 400, 22pt, #C9C6C0
│  greenways · bridges · parks     │
│                                  │
│  rules.cityofnewyork.us          │  Mono 400, 16pt, #86B54F
└──────────────────────────────────┘
```

**Rule:** effective date in the kicker, source domain at the foot. Every time.

---

## T7 — The Screen

**Use for:** C02, C08, C10, C26.

A real device screenshot, dropped into a simple black-keylined phone frame on `#EFF5E6`, with one or two green callout arrows.

**Rule: do not redesign the screen.** The persuasive force of these posts is that it's the actual app. Crop and annotate; never rebuild.

**Before using any app screenshot, check:** no test persona ("JOSEPH BUFFET"), no 555 phone number, no empty state ("NO PROMOTIONS AVAILABLE NEARBY", "SERVICE HISTORY (0)"), no real customer's name or address.

---

## T8 — Carousel Grid

**Use for:** every multi-slide carousel.

| Slide | Job |
|---|---|
| 1 | The claim. One number, one line. Must work alone as a feed thumbnail. |
| 2–5 | The proof. One idea per slide. |
| 6 | **The honest caveat** — what's not included, the minimum term, the qualifier |
| 7 | CTA + source list |

**Slide 6 is the template's whole point.** Building the caveat into the structure means nobody has to remember to add it.

---

## Charts

For the break-even chart (C04, C24) and any earnings math, read the `dataviz` skill before drawing anything. Minimum standards here:

- Two or three series maximum
- Direct labels on the lines, not a legend
- Axes start at zero
- Mark the crossover point explicitly with a label, since it's the entire message
- Works in greyscale — a meaningful share of the audience will see it screenshotted and re-compressed
- Brand green `#86B54F` for the Foodyzz series, `#57534E` for comparison series. Never red/green as the only distinction.

---

## Build checklist

- [ ] Black type on green fill, never white
- [ ] Prices in JetBrains Mono
- [ ] Hard shadow, zero blur
- [ ] Source on the graphic for every statistic
- [ ] The qualifier is on the same card as the number
- [ ] Legible at 30% zoom (feed thumbnail size)
- [ ] Type outside the TikTok bottom-250px UI zone
- [ ] No stock, no AI imagery, no UniHamper assets
