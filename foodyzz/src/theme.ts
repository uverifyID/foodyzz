export const COLORS = {
  // Brand green sampled from the foodyzz wordmark (#86B54F, hue 88°, S41 L51).
  // `green` is a FILL tone: white text on it is only 2.4:1, so it always carries
  // BLACK ink (8.7:1) — which also suits the black-bordered brutalist surfaces.
  // `greenDark` is the text-on-white tone (5.4:1); `greenMid` is hover/pressed.
  brand: {
    green: "#86B54F",
    greenMid: "#658F32",
    greenDark: "#507425",
    greenInk: "#2B4011",
  },
  neutral: {
    black: "#000000",
    white: "#FFFFFF",
    slate: {
      50: "#F8FAFC",
      200: "#E2E8F0",
      800: "#1E293B",
      900: "#0F172A",
    }
  },
  // Order lifecycle. Now that the brand is green, "completed/delivered" uses the
  // BRAND green rather than emerald — the two were only ΔE 12.5 apart in normal
  // vision (below the 15 floor), so side by side they read as the same colour.
  // Open/in-flight moves to indigo, which separates cleanly from both.
  status: {
    open: "#507425",
    confirmed: "#EAB308",
    completed: "#658F32",
    delivered: "#507425",
    cancelled: "#E11D48",
  }
};

export const LAYOUT = {
  brutalist: {
    borderWidth: 2,
    shadowOffset: 4,
    shadowColor: "#000000",
  },
  borderRadius: {
    card: 16,
    banner: 24,
  }
};