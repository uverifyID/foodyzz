# Blotato — Auto-Publishing to IG / FB / TikTok

Blotato is an API-first social automation platform (publish, schedule, AI content, analytics). It
supports Instagram, Facebook, TikTok, LinkedIn, X, Pinterest, YouTube, and more. It is **MCP-ready
for Claude Code** and ships official **n8n** and **Make** nodes. This is UniHamper's social publishing engine.

Docs: https://help.blotato.com/api/start · Publish endpoint: https://help.blotato.com/api/api-reference/publish-post

## Setup checklist
1. Create a Blotato account; choose a plan that includes the 3 accounts + API access. ⚠️ CONFIRM budget.
2. Connect the accounts inside Blotato:
   - **Instagram @unihamperhq** — must be a **Business or Creator** account, linked to the FB Page.
   - **Facebook Page** — https://www.facebook.com/profile.php?id=61591701426017
   - **TikTok @unihamper** — connect via Blotato's TikTok auth.
3. Grab your **API key** from Blotato settings. Store it as an env secret (never commit it). ⚠️ CONFIRM: key.
4. (Recommended) Install the **Blotato MCP server** in Claude Code, or the n8n node, so the pipeline can post programmatically.

## How posting works
- Endpoint: `POST /v2/posts` with the target account id, caption text, media (image/video URL), and either a `scheduledTime` or `useNextFreeSlot: true`.
- **Media must be a hosted URL** — upload the graphic/video first (Blotato media upload, or host in Drive/S3) and pass the URL.
- **Rate limit:** 30 post-creation requests/minute (per user). Plenty for our volume.
- Scheduling: set exact times from `02-social/launch-calendar.md`, or let Blotato drip via next-free-slot.

## The repo → Blotato mapping
Our posts live as markdown in `02-social/`. Each post already has: platform, caption, hashtags,
visual direction. To publish one, the pipeline needs: `{account, text: caption+hashtags, mediaUrl, scheduledTime}`.

Suggested minimal payload (illustrative — verify field names against the live API reference):
```jsonc
{
  "post": {
    "target": { "targetType": "instagram", "accountId": "<IG_ACCOUNT_ID>" },
    "content": {
      "text": "<caption + hashtags>",
      "mediaUrls": ["https://.../graphic.png"]
    }
  },
  "scheduledTime": "2026-07-15T16:00:00Z"   // or: "useNextFreeSlot": true
}
```

## Two operating modes
- **Manual-assist:** generate content in this repo → paste into Blotato's UI → schedule. Good for weeks 1–2.
- **Automated:** n8n workflow reads the week's approved posts (Google Sheet or the RSS feed) → calls `/v2/posts` for each. See the n8n templates "Auto-publish social videos via Google Sheets and Blotato" and "Automate content publishing to TikTok/YouTube/Instagram/Facebook via Blotato."

## Platform gotchas (real constraints)
- **Instagram:** API posting requires a Business/Creator account; personal accounts can't auto-post. First comment / some sticker types may not be supported via API.
- **TikTok:** API-posted videos may land as private/draft depending on TikTok's unaudited-client rules until the app is approved — verify the first post publishes public. Vertical 1080×1920, MP4.
- **Facebook:** post to the Page, not a personal profile.
- Always keep captions within each platform's limits; keep hashtags in-caption for IG (8–15), lighter for FB/TikTok.

## ⚠️ CONFIRM items
- Blotato plan + **API key**
- IG converted to Business/Creator + linked to the FB Page
- TikTok posting approved for public (test post)
- Where media is hosted (Blotato upload vs Drive/S3) for the `mediaUrl`

Sources: [Blotato](https://www.blotato.com/) · [API Quickstart](https://help.blotato.com/api/start) · [Publish Post](https://help.blotato.com/api/api-reference/publish-post) · [n8n + Blotato template](https://n8n.io/workflows/7187-automate-content-publishing-to-tiktok-youtube-instagram-facebook-via-blotato/)
