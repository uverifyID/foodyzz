# Phase 2 — Notes & Open Items

Phase 1 (done) replicates the reference site's structure and neo-brutalist look
using the **unihamper** logo and a placeholder palette. Phase 2 is polish.

## 1. Final color template

You asked to "use webadmin for the color template." **No `webadmin` folder
exists** anywhere in the `Laundry` repo or sibling projects, so Phase 1 falls
back to the reference site's own palette.

When you have the intended colors (or point me to webadmin), update them in **one
place** — [`tailwind.config.ts`](tailwind.config.ts):

```ts
accent: { yellow: "...", blue: "...", pink: "..." },
brand:  { orange: "#FF4D00" },   // current UniHamper brand from scrubs/src/theme.ts
ink:    "#0A0A0A",
```

Component markup references semantic names (`bg-accent-yellow`, `bg-accent-blue`,
`bg-accent-pink`, `border-ink`, `text-brand-orange`), so swapping the palette
requires **no component edits**.

The UniHamper brand palette already in the app (`scrubs/src/theme.ts`): orange
`#FF4D00`, indigo `#4338ca`, pink `#f472b6`, slate neutrals.

## 2. Real store + QR links + Formspree

In [`src/lib/siteConfig.ts`](src/lib/siteConfig.ts):
- `appStoreUrl` / `playStoreUrl` are placeholders — update once the apps are
  listed (store buttons + QR codes follow automatically).
- `formspreeId` is `"your-form-id"` — create a form at formspree.io and paste the
  real ID so the contact form delivers email. (This is a static site, so the
  earlier server-side SMTP/Firestore approach is not used.)

## 3. Content to confirm

- FAQ answers in `siteConfig.ts` are drafted from the reference copy — review for
  accuracy (pricing model, coverage areas).
- Contact email + social handles in `siteConfig.ts` are placeholders
  (`hello@unihamper.com`, `instagram.com/unihamper`, …).

## 4. Nice-to-haves

- Replace inline store-badge SVGs with the official Apple/Google badge art if
  brand guidelines require it.
- Add OG/social share image (`public/og.png`) — referenced via metadata.
- Optional: split provider/customer into dedicated pages if you want deeper copy.
