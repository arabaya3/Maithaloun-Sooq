# Customer accounts

Optional customer accounts for the storefront. Guest checkout is unchanged and never requires an account.

## Sign-in method

Phone number with a 6-digit SMS code through **Supabase Auth**. Supabase generates, stores and checks the codes; this app never stores them. After verification the app issues its own session, separate from admin sessions.

Why: neither an SMS nor an email provider was configured. Orders are identified by phone, so only a verified phone can safely claim past guest orders. Email + password would need email delivery for verification and reset, and could never match orders.

## Configuration

| Variable                | Values                                  | Notes                                                                                                                 |
| ----------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `CUSTOMER_ACCOUNTS`     | `on` / anything else                    | Off by default. When off, `/account` explains that accounts are not available yet, and favourites stay on the device. |
| `CUSTOMER_OTP_PROVIDER` | `supabase`                              | Uses the existing `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.                                                           |
| `CUSTOMER_OTP_PROVIDER` | `development` + `CUSTOMER_OTP_DEV_CODE` | Local development and automated tests only. Refused when `NODE_ENV=production` or on Vercel.                          |

Before turning accounts on in Production:

1. Supabase dashboard → Authentication → Providers → Phone: enable it and connect an SMS provider (Twilio, MessageBird, Vonage or Textlocal) that can deliver to +970 and +972 numbers.
2. Set the OTP expiry (5 minutes recommended) and the SMS template in Arabic.
3. Apply migration `0014_customer_accounts.sql`.
4. Set `CUSTOMER_OTP_PROVIDER=supabase`, then `CUSTOMER_ACCOUNTS=on`.

## Security model

- Session: random 256-bit token, only its SHA-256 hash is stored. HttpOnly, `Secure` in production, `SameSite=Lax`, `__Host-` prefix. Absolute lifetime 60 days, idle timeout 30 days.
- A new token is issued at every sign-in and any token the browser already carried is revoked, so a planted session cannot be reused.
- Mutations are server actions that also check `Origin` against `APP_ORIGIN` and `Sec-Fetch-Site`.
- Rate limits (hashed with the existing pepper):
  - code requests: 3 per phone per 15 minutes, 8 per phone per day, 10 per network per 15 minutes;
  - verification: 5 per phone and 20 per network per 15 minutes.
- Code requests answer the same way whether or not the number has an account.
- Every query is scoped to the signed-in account; order history goes through `customer_order_links`, whose primary key is the order id, so an order has at most one owner.
- Claiming past orders matches only orders whose phone equals the account's verified phone and that are not already linked. Claims are recorded in the append-only `customer_account_events`.
- New tables have RLS enabled and no grants to `anon` or `authenticated`.
- Logs and the admin assistant never receive customer phone numbers, addresses or tokens.

## Data and deletion

- Order snapshots are never modified; ownership lives in `customer_order_links`.
- Deleting an account removes sessions, addresses, favourites and order links, and clears name, phone and WhatsApp. Orders remain for the store's financial records as guest orders. The phone number can register again.

## Favourites

- Guests: validated local storage on the device. A product hidden since it was saved is dropped alone, not the whole list.
- Signed in: stored on the server. Device favourites are merged only when the customer presses «إضافة إلى حسابي»; merging adds only and is safe to retry.
- Offline: the offline page lists the guest's last saved favourites by name.

## Reorder

The server compares each item with the current catalog. If a price changed or an item is unavailable, the customer sees a review listing old and current prices before anything is added to the cart. Checkout recalculates all prices as before.
