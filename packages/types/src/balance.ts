import type { CurrencyCode } from "./reward";

export interface Balance {
  userId: string;
  currency: CurrencyCode;
  amount: number;
  updatedAt: number;
}
