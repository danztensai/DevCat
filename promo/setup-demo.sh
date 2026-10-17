#!/bin/bash
# Creates the folder the demo screens browse: a small sample project with a branchy history
# (made-up authors) and one uncommitted fix (AI workspace, Diff).
set -euo pipefail
ROOT="${DEMO_ROOT:-/tmp/devcat-demo}"
rm -rf "$ROOT" && mkdir -p "$ROOT"

S="$ROOT/storefront"
mkdir -p "$S/src/cart" "$S/src/api" "$S/src/components" "$S/tests"
cd "$S"
git init -q -b main
git config user.name "Ava Tan"; git config user.email "ava@example.com"
commit() { git add -A; GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git -c commit.gpgsign=false commit -q -m "$2"; }
as() { git config user.name "$1"; git config user.email "$2"; }
merge() { GIT_AUTHOR_DATE="$1" GIT_COMMITTER_DATE="$1" git -c commit.gpgsign=false merge -q --no-ff "$2" -m "$3"; }
note() { echo "$2" >> "$1"; }

cat > package.json <<'J'
{ "name": "storefront", "private": true, "scripts": { "dev": "vite", "test": "vitest" } }
J
cat > README.md <<'M'
# Storefront

Acme's web shop: product pages, cart and checkout.

```sh
pnpm install
pnpm dev
```
M
cat > src/cart/total.ts <<'T'
import { applyCoupon, type Coupon } from "./coupon";

export interface Line { sku: string; price: number; qty: number }
export interface Cart { lines: Line[]; coupon?: Coupon | null; taxRate: number }

const round = (n: number) => Math.round(n * 100) / 100;
export const sumLines = (lines: Line[]) => lines.reduce((s, l) => s + l.price * l.qty, 0);

/** Order total shown on the checkout page. */
export function cartTotal(cart: Cart): number {
  const withTax = (n: number) => n * (1 + cart.taxRate);
  const subtotal = sumLines(cart.lines);
  const discount = applyCoupon(withTax(subtotal), cart.coupon);
  return round(withTax(subtotal - discount));
}
T
cat > src/cart/coupon.ts <<'T'
export type Coupon = { kind: "percent"; value: number } | { kind: "fixed"; value: number };

export function applyCoupon(amount: number, coupon?: Coupon | null): number {
  if (!coupon) return 0;
  return coupon.kind === "percent" ? amount * (coupon.value / 100) : Math.min(coupon.value, amount);
}
T
cat > src/api/client.ts <<'T'
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
T
cat > src/components/Checkout.tsx <<'T'
import { cartTotal, type Cart } from "../cart/total";

export function Checkout({ cart }: { cart: Cart }) {
  return <section><h2>Total</h2><p>{cartTotal(cart).toFixed(2)}</p></section>;
}
T
cat > tests/total.test.ts <<'T'
import { expect, test } from "vitest";
import { cartTotal } from "../src/cart/total";

test("no coupon", () => {
  expect(cartTotal({ lines: [{ sku: "a", price: 10, qty: 2 }], taxRate: 0.1 })).toBe(22);
});
T
commit "2026-09-22T10:00:00" "Initial storefront"
echo "export const CURRENCY = \"USD\";" > src/config.ts
commit "2026-09-23T14:12:00" "Add currency config"
git tag v1.0.0

git switch -q -c feature/coupons
as "Noah Silva" "noah@example.com"
note src/cart/coupon.ts "// fixed coupons never exceed the amount"
commit "2026-09-24T09:15:00" "Coupons: cap fixed discounts at the order amount"
note tests/total.test.ts "// TODO: coupon cases"
commit "2026-09-25T11:02:00" "Coupons: test scaffolding"

git switch -q main
as "Mia Novak" "mia@example.com"
mkdir -p src/search && echo "export const search = (q: string) => fetch(\`/api/search?q=\${q}\`);" > src/search/index.ts
commit "2026-09-25T16:40:00" "Search: query endpoint"
git switch -q -c feature/search-suggest
echo "export const suggest = (q: string) => fetch(\`/api/suggest?q=\${q}\`);" > src/search/suggest.ts
commit "2026-09-26T10:20:00" "Search: suggestions while typing"
note src/search/suggest.ts "// debounce in the component"
commit "2026-09-29T13:05:00" "Search: debounce suggestions"

git switch -q main
as "Ava Tan" "ava@example.com"
sed -i '' 's/return <section>/return <section className="checkout">/' src/components/Checkout.tsx
commit "2026-09-30T09:40:00" "Style the checkout summary"
merge "2026-10-01T15:00:00" feature/coupons "Merge branch 'feature/coupons'"
as "Noah Silva" "noah@example.com"
note src/api/client.ts "// retries are handled by the gateway"
commit "2026-10-02T10:10:00" "API client: document retries"
as "Mia Novak" "mia@example.com"
merge "2026-10-03T17:30:00" feature/search-suggest "Merge branch 'feature/search-suggest'"
git tag v1.1.0

git switch -q -c fix/checkout-rounding
as "Ava Tan" "ava@example.com"
note src/cart/total.ts "// totals are rounded to cents once, at the end"
commit "2026-10-06T11:45:00" "Checkout: round the total once"
git switch -q main
as "Noah Silva" "noah@example.com"
echo "export const FREE_SHIPPING_FROM = 50;" >> src/config.ts
commit "2026-10-07T09:30:00" "Free shipping threshold"
as "Ava Tan" "ava@example.com"
merge "2026-10-08T14:20:00" fix/checkout-rounding "Merge branch 'fix/checkout-rounding'"
git branch -q -d fix/checkout-rounding
git switch -q -c feature/gift-cards
as "Mia Novak" "mia@example.com"
mkdir -p src/giftcards && echo "export interface GiftCard { code: string; balance: number }" > src/giftcards/types.ts
commit "2026-10-13T10:00:00" "Gift cards: types"
echo "export const redeem = (code: string) => fetch(\`/api/giftcards/\${code}\`, { method: \"POST\" });" > src/giftcards/redeem.ts
commit "2026-10-15T15:45:00" "Gift cards: redeem endpoint"
git switch -q main
as "Ava Tan" "ava@example.com"
note README.md "Deployed from \`main\` on every merge."
commit "2026-10-16T12:00:00" "README: deploy notes"
git tag v1.2.0
git update-ref refs/remotes/origin/main HEAD

# The fix from the AI workspace demo, left uncommitted for the Diff view.
cat > src/cart/total.ts <<'T'
import { applyCoupon, type Coupon } from "./coupon";

export interface Line { sku: string; price: number; qty: number }
export interface Cart { lines: Line[]; coupon?: Coupon | null; taxRate: number }

const round = (n: number) => Math.round(n * 100) / 100;
export const sumLines = (lines: Line[]) => lines.reduce((s, l) => s + l.price * l.qty, 0);

/** Order total shown on the checkout page. */
export function cartTotal(cart: Cart): number {
  const withTax = (n: number) => n * (1 + cart.taxRate);
  const subtotal = sumLines(cart.lines);
  const discount = applyCoupon(subtotal, cart.coupon);
  // tax is charged on the discounted amount
  return round(withTax(subtotal - discount));
}
// totals are rounded to cents once, at the end
T
cat >> tests/total.test.ts <<'T'

test("percent coupon applies before tax", () => {
  const cart = { lines: [{ sku: "a", price: 50, qty: 2 }], taxRate: 0.1, coupon: { kind: "percent", value: 20 } as const };
  expect(cartTotal(cart)).toBe(88);
});
T
echo "$ROOT"
