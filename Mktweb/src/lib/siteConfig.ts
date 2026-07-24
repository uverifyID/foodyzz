// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for marketing copy + links.
// Edit store URLs here once you have real listings; QR codes regenerate to match.
// ─────────────────────────────────────────────────────────────────────────────

export const site = {
  name: "UniHamper",
  tagline: "Uber for Laundry",
  email: "hello@unihamper.com",
  // Contact form posts here. Create a form at https://formspree.io, then paste
  // its ID (the part after /f/, e.g. "xayzwlkr") here. Until set, the form
  // shows a friendly "not configured yet" message instead of failing.
  formspreeId: "your-form-id",
  social: {
    instagram: "https://instagram.com/unihamper",
    tiktok: "https://tiktok.com/@unihamper",
    x: "https://x.com/unihamper",
  },
} as const;

// Two apps, one platform: customers use UniHamper, providers use UniHamper HQ.
// Update each store URL when the listings go live — store buttons + QR follow.
export const apps = {
  customer: {
    key: "customer",
    name: "UniHamper",
    appStore: "https://apps.apple.com/app/unihamper",
    playStore: "https://play.google.com/store/apps/details?id=app.unihamper",
  },
  provider: {
    key: "provider",
    name: "UniHamper HQ",
    appStore: "https://apps.apple.com/app/unihamper-hq",
    playStore: "https://play.google.com/store/apps/details?id=app.unihamper.hq",
  },
} as const;

export type AppInfo = (typeof apps)[keyof typeof apps];

export const ticker = [
  "STUDENT-FRIENDLY PRICING",
  "EARN ON YOUR OWN TIME",
  "BUILT FOR BUSY PEOPLE",
  "LAUNDROMATS WELCOME",
  "UBER FOR LAUNDRY",
  "TAP. TOSS. DONE.",
];

// ── How it works (customers) ─────────────────────────────────────────────────
export const customerSteps = [
  {
    n: "01",
    icon: "box",
    title: "Request a pickup",
    body: "Set a window, add notes (detergent, hangers, no-shrink). We confirm in seconds.",
  },
  {
    n: "02",
    icon: "shirt",
    title: "We wash & fold",
    body: "A vetted provider or local laundromat handles the cycle. Track it live in-app.",
  },
  {
    n: "03",
    icon: "truck",
    title: "Fresh delivery",
    body: "Folded, bagged, and dropped at your door. Tap to tip. Done in under 24 hours.",
  },
];

// ── Two ways to earn (providers) ─────────────────────────────────────────────
export const providerOffers = [
  {
    tag: "Gig Hustlers",
    icon: "cash",
    title: "Flexible side income, on your washer's schedule.",
    body: "Already doing laundry for yourself? Add a couple of loads, drop them off on your commute, pocket cash. No supervisor, no shifts — you're in charge.",
    features: [
      { icon: "clock", label: "Set your hours" },
      { icon: "cash", label: "Daily* payouts" },
      { icon: "star", label: "Keep your tips" },
    ],
  },
  {
    tag: "Laundromats",
    icon: "building",
    title: "Fill empty machines. Add a delivery channel overnight.",
    body: "Plug your shop into a steady stream of pickups. Use idle hours and idle drums. UniHamper handles the customers and logistics.",
    features: [],
  },
];

export const providerStats = [
  { value: "24h", label: "Average turnaround" },
  { value: "$18–$32", label: "Per hour earnings*" },
  { value: "100%", label: "Pickup tracking" },
  { value: "0", label: "Long-term contracts" },
];

export const providerStatsFootnote =
  "* Provider earnings vary by region, hours and tips.";

// ── Built for busy people ────────────────────────────────────────────────────
export const busyFeatures = [
  {
    icon: "cap",
    title: "Student-friendly pricing",
    body: "Transparent per-pound rates. No surprise fees, ever.",
  },
  {
    icon: "smile",
    title: "Folded the way you want",
    body: "Hang, fold, separate, scent-free. Set your preferences once.",
  },
  {
    icon: "shield",
    title: "Tracked & insured",
    body: "Live status, photo proof, and protection on every order.",
  },
  {
    icon: "moon",
    title: "Late-night pickups",
    body: "Schedules built for class loads — and the occasional all-nighter.",
  },
];

// ── FAQ ──────────────────────────────────────────────────────────────────────
export const faqs = [
  {
    q: "What is UniHamper?",
    a: "UniHamper connects busy people who need laundry done with neighbors and laundromats who'll wash, dry, fold, and return it. One tap to send it out — or one tap to start earning.",
  },
  {
    q: "How does pickup work?",
    a: "Schedule a pickup in about 30 seconds in the app. A nearby provider grabs your bag, cleans it, and brings it back fresh — perfect for dorms, late-night study marathons, and adulting.",
  },
  {
    q: "How much does it cost?",
    a: "UniHamper is built around student-friendly pricing. You see the price up front before you confirm — no surprises. Final pricing is set by the provider you choose.",
  },
  {
    q: "How do I earn as a provider?",
    a: "Got a washer, a car, and free time — or an under-used laundromat? Set your hours, pick the jobs you want, and get paid with weekly payouts. You keep your tips and you're in control of your schedule.",
  },
  {
    q: "Do I need my own equipment to be a provider?",
    a: "A home washer/dryer works, and laundromats are welcome too. If you have access to machines and time, you can earn on UniHamper HQ.",
  },
  {
    q: "What's the difference between UniHamper and UniHamper HQ?",
    a: "UniHamper is the customer app for sending out laundry. UniHamper HQ is the provider app for earning. Same platform — pick whichever side you're on, or both.",
  },
  {
    q: "Where is UniHamper available?",
    a: "We're rolling out neighborhood by neighborhood, starting around colleges and busy communities. Download the app to see availability in your area.",
  },
  {
    q: "How do I get the app?",
    a: "Tap “Get the App,” or scan the QR code on this site with your phone to download from the App Store or Google Play.",
  },
];

export type Faq = (typeof faqs)[number];
