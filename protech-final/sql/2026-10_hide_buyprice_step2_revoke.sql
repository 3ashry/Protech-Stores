-- ════════════════════════════════════════════════════════════════════
-- HIDE BUY PRICE — STEP 2 of 2: hide the real products table from the public
-- Run this ONLY AFTER the storefront has been redeployed to read
-- `store_products` (confirm protechstores.com still shows products first).
--
-- This removes the public key's access to the real `products` table, so
-- buy_price (and the whole cost side) is completely invisible to anyone
-- not logged in. The admin (authenticated) and serverless (service_role)
-- keep full access. The public only ever sees the cost-free view.
-- ════════════════════════════════════════════════════════════════════

revoke select on public.products from anon;

notify pgrst, 'reload schema';

-- ── VERIFY (optional) ──
-- With the Anon key, a direct read of products should now be denied,
-- while the view still works:
--   GET /rest/v1/products?select=buy_price   → denied / empty
--   GET /rest/v1/store_products?select=*     → published products, no cost
--
-- ── ROLLBACK (if the store breaks) ──
--   grant select on public.products to anon;
--   notify pgrst, 'reload schema';
