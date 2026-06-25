# 🔐 Protech — Security Setup (ACTION REQUIRED)

The code has been hardened (XSS escaping, secrets moved to env vars, input encoding,
security headers). But a few things can only be done in your **Supabase** and **Vercel**
dashboards. Do these in order. Until step 1–3 are done, the new `api/` functions return
"Server not configured" and the database is still wide open.

---

## 1. Rotate the leaked keys (they were committed in plaintext — assume compromised)

- **Bosta**: dashboard → API/Developers → revoke the old key, generate a new one.
- **OneSignal**: app → Settings → Keys & IDs → regenerate the REST API Key.
- **Supabase**: the publishable key is necessarily public (it ships in the browser), so it
  does not need rotating *by itself* — but it only becomes safe once RLS is fixed (step 4).
  Never expose the **service_role** key in client code.

## 2. Set Vercel Environment Variables

Project **Protech-Stores** → Settings → Environment Variables (Production + Preview):

| Name | Value |
|------|-------|
| `BOSTA_API_KEY` | your **new** Bosta key |
| `SUPABASE_URL` | `https://wljxplbcfoorqpoflcdz.supabase.co` |
| `SUPABASE_KEY` | your Supabase key (service_role preferred for server-side writes) |
| `ONESIGNAL_API_KEY` | your **new** OneSignal REST key |
| `ONESIGNAL_APP_ID` | `ffdfd9c4-f089-4d84-b38a-17b869d0e0ea` |
| `ALLOWED_ORIGINS` | `https://protech-stores.vercel.app,https://YOUR-STOREFRONT-DOMAIN` |
| `NOTIFY_SECRET` | (optional) a random string to gate /api/notify |

Redeploy after saving.

## 3. The serverless functions moved

`bosta.js` / `notify.js` are now in **`/api`** (real Vercel functions) instead of
`public/api` (where they were served as raw static files, leaking the keys). The URLs
(`/api/bosta`, `/api/notify`) are unchanged.

## 4. 🔴 Lock down the database (RLS) — the most important fix

Right now every table is `for all using(true)` → **anyone with the public key can read,
edit, and delete all your data** (customer names, phones, addresses, finances).

⚠️ **Applying the SQL below will break the dashboard and the storefront's admin/edit
features until they authenticate** (they currently use the public key for everything).
Plan: run this SQL *together with* switching the dashboard login to **Supabase Auth**
(ask me to implement that part — it's a code change to `db.js` and the storefront admin).

```sql
-- Run in Supabase → SQL Editor. Adjust table/column names to your live schema.

-- PRODUCTS: public can read, only authenticated admins can write
drop policy if exists "allow_all_products" on products;
create policy "products_public_read" on products for select to anon using (true);
create policy "products_admin_write" on products for all to authenticated using (true) with check (true);

-- ORDERS: public can ONLY insert (place an order). No public read/update/delete.
drop policy if exists "allow_all_orders" on orders;
create policy "orders_public_insert" on orders for insert to anon with check (true);
create policy "orders_admin_all"    on orders for all    to authenticated using (true) with check (true);

-- FEEDBACKS: public can only insert
drop policy if exists "allow_all_feedbacks" on feedbacks;
create policy "feedbacks_public_insert" on feedbacks for insert to anon with check (true);
create policy "feedbacks_admin_all"     on feedbacks for all    to authenticated using (true) with check (true);

-- EXPENSES: admins only (no public access)
drop policy if exists "allow_all_expenses" on expenses;
create policy "expenses_admin_all" on expenses for all to authenticated using (true) with check (true);

-- The tables below were created after supabase_setup.sql — enable RLS if not already:
-- SITE_SETTINGS: public read, admin write
alter table if exists site_settings enable row level security;
create policy "settings_public_read" on site_settings for select to anon using (true);
create policy "settings_admin_all"   on site_settings for all    to authenticated using (true) with check (true);

-- ANALYTICS_EVENTS: public insert only, admin read
alter table if exists analytics_events enable row level security;
create policy "analytics_public_insert" on analytics_events for insert to anon with check (true);
create policy "analytics_admin_all"     on analytics_events for all    to authenticated using (true) with check (true);

-- SUPPLIER_PAYMENTS: admins only
alter table if exists supplier_payments enable row level security;
create policy "supplier_admin_all" on supplier_payments for all to authenticated using (true) with check (true);
```

### Storage bucket
In Supabase → Storage → `protech-media` → Policies: allow public **read**, but restrict
**insert/update/delete** to `authenticated` only (otherwise anyone can overwrite your images).

## 5. Real login (Supabase Auth) — ALREADY IMPLEMENTED IN CODE ✅

The hardcoded passwords are gone. The dashboard (`db.js`) and the storefront admin
(`App.jsx`) now sign in with **Supabase Auth** (email + password) and use the returned
JWT for all writes, so the RLS `authenticated` policies above protect everything.

**Do the activation in THIS ORDER (or you can lock yourself out):**

1. **Create your login user FIRST.** Supabase → Authentication → Providers → enable **Email**.
   Then Authentication → Users → **Add user** → enter your email + a strong password →
   tick **Auto Confirm User**.
2. **Then deploy the new code** (merge the `claude/clever-pascal-8lmsrd` branch to `main`
   in both repos). Now both apps require that email/password to enter admin. Logging in
   still has full access at this point (RLS not applied yet), so verify you can sign in.
3. **Then run the RLS SQL** from step 4. After this, only your authenticated login can
   read/write the sensitive data; the public can only browse products and place orders.

> If anything goes wrong, you can roll back by reverting the branch merge — the previous
> commit still works. Don't run the RLS SQL until you've confirmed login works.

### Order tracking by phone
The storefront's "track my order by phone" did an open `select` on `orders` (anyone could
enumerate any customer's data). After RLS this stops working by design — if you want it
back, it should be a Supabase RPC that returns minimal fields for an exact phone+code match.
