export type Reward =
  | { kind: "currency"; currency: CurrencyCode; amount: number }
  | { kind: "badge"; badgeId: string }
  | { kind: "item"; itemId: string; quantity: number };

export type CurrencyCode = "coin" | "point" | "gem" | string;
