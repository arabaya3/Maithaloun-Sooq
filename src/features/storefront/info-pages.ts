export const infoPages = [
  { key: "about", href: "/about" },
  { key: "contact", href: "/contact" },
  { key: "delivery", href: "/delivery" },
  { key: "returns", href: "/returns" },
  { key: "privacy", href: "/privacy" },
  { key: "terms", href: "/terms" },
] as const;

export type InfoPageKey = (typeof infoPages)[number]["key"];
