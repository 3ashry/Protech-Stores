-- ============================================================================
-- Agent views — the clean, read-only numbers the Protech agent team reads.
-- Everything lives in its own schema `agent`, which is NOT exposed through
-- the public API (anon / authenticated get no access). Views only: nothing
-- here changes or stores data.
--
-- Money rules used throughout (check these — every number depends on them):
--   * Goods revenue    = order total − est_shipping (est_shipping is what the
--                        customer paid for shipping; true for 461/508 orders,
--                        the rest have free shipping or a manual discount).
--   * Courier cost     = actual_shipping, charged on delivered AND returned orders.
--   * Unit cost        = latest Elashry invoice price for that code (total/qty
--                        from supplier_invoices.price_map); if the code was
--                        never invoiced, products.buy_price (matches the
--                        invoiced net price within ~0.3% where both exist).
--   * Ad spend         = meta_ad_spend_daily (Meta's daily spend).
--   * Media buyer      = 1% of (goods revenue − courier cost) on delivered
--                        orders + 20% of ad spend.
--   * Returned goods come back to stock, so a return costs courier only.
--   * Outcomes: delivered / returned / cancelled / not_shipped (customer never
--     confirmed, so it never left the warehouse) / open (still in progress).
--     Ad spend is shared across ALL orders placed that month, so unconfirmed
--     orders carry their share of the ad cost that produced them.
-- ============================================================================

create schema if not exists agent;
revoke all on schema agent from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Every product code ever sold: current catalog first, then the Oct 17
-- deleted-products table, then the Oct 15 backup (older, removed items).
-- ---------------------------------------------------------------------------
create or replace view agent.catalog_all as
select distinct on (code) code, name, brand, price, buy_price, source
from (
  select code, name, brand, price, buy_price, 1 as pri, 'current' as source from public.products
  union all
  select code, name, brand, price, buy_price, 2, 'deleted_2026-10-17' from public.products_deleted_20261017
  union all
  select code, name, brand, price, buy_price, 3, 'backup_2026-10-15' from public.products_backup_20261015
) c
where coalesce(code, '') <> ''
order by code, pri;

-- ---------------------------------------------------------------------------
-- Unit cost per product code
-- ---------------------------------------------------------------------------
create or replace view agent.unit_cost as
with inv as (
  select kv.key as code,
         (kv.value->>'total')::numeric / nullif((kv.value->>'qty')::numeric, 0) as unit_cost,
         coalesce(si.prepared_date, si.created_at::date) as invoiced_on,
         row_number() over (partition by kv.key
                            order by coalesce(si.prepared_date, si.created_at::date) desc, si.created_at desc) as rn
  from public.supplier_invoices si,
       jsonb_each(coalesce(si.price_map, '{}'::jsonb)) kv
)
select p.code,
       coalesce(i.unit_cost, p.buy_price) as unit_cost,
       case when i.unit_cost is not null then 'invoice' else 'list_buy_price' end as cost_source,
       i.invoiced_on
from agent.catalog_all p
left join inv i on i.code = p.code and i.rn = 1;

-- ---------------------------------------------------------------------------
-- One row per order line. Historical combo lines ("A+B") are split into their
-- parts; the line's revenue is shared out in proportion to the parts' prices.
-- ---------------------------------------------------------------------------
create or replace view agent.order_lines as
with lines as (
  select o.id as order_id, o.code as order_code,
         (o.created_at at time zone 'Africa/Cairo')::date as order_date,
         case when o.status = 'Delivered' then 'delivered'
              when o.status = 'Returned'  then 'returned'
              when o.status = 'Cancelled' then 'cancelled'
              -- never sent for preparation and older than 3 days: the customer
              -- didn't confirm, so it was never shipped
              when o.sent_to_picker_at is null and o.created_at < now() - interval '3 days' then 'not_shipped'
              else 'open' end as outcome,
         li.ordinality as line_no,
         li.value->>'code' as line_code,
         coalesce((li.value->>'qty')::int, 1) as qty,
         coalesce((li.value->>'price')::numeric, 0) as unit_price
  from public.orders o,
       jsonb_array_elements(coalesce(o.products, '[]'::jsonb)) with ordinality li
),
parts as (
  select l.*, trim(part) as code,
         count(*) over (partition by l.order_id, l.line_no) as n_parts
  from lines l, unnest(string_to_array(l.line_code, '+')) part
),
catalog as (select code, name, price, brand from agent.catalog_all),
priced as (
select pt.order_id, pt.order_code, pt.order_date, pt.outcome,
       pt.code, c.name, c.brand,
       pt.qty,
       pt.line_code <> pt.code as from_combo,
       -- revenue share: by catalog price when every part has one, else equal split
       round(pt.unit_price * pt.qty *
         case when count(c.price) over (partition by pt.order_id, pt.line_no) = pt.n_parts
                   and sum(c.price) over (partition by pt.order_id, pt.line_no) > 0
              then c.price / sum(c.price) over (partition by pt.order_id, pt.line_no)
              else 1.0 / pt.n_parts end, 2) as revenue,
       uc.unit_cost,
       uc.cost_source,
       c.name is null as unknown_product
from parts pt
left join catalog c on c.code = pt.code
left join agent.unit_cost uc on uc.code = pt.code
),
-- Codes found nowhere have no cost; estimate them at the store-wide
-- cost-to-revenue ratio of the lines we do know, and label them 'estimated'.
ratio as (
  select sum(unit_cost * qty) / nullif(sum(revenue), 0) as r
  from priced where unit_cost is not null and revenue > 0
)
select p.order_id, p.order_code, p.order_date, p.outcome, p.code, p.name, p.brand, p.qty,
       p.from_combo, p.revenue, p.unit_cost,
       case when p.unit_cost is null then 'estimated' else p.cost_source end as cost_source,
       round(coalesce(p.unit_cost * p.qty, p.revenue * ratio.r), 2) as goods_cost,
       p.unknown_product
from priced p cross join ratio;

-- ---------------------------------------------------------------------------
-- Per-order economics, including a share of that month's ad spend.
-- ---------------------------------------------------------------------------
create or replace view agent.order_economics as
with o as (
  select o.id as order_id, o.code as order_code,
         (o.created_at at time zone 'Africa/Cairo')::date as order_date,
         date_trunc('month', o.created_at at time zone 'Africa/Cairo')::date as month,
         case when o.status = 'Delivered' then 'delivered'
              when o.status = 'Returned'  then 'returned'
              when o.status = 'Cancelled' then 'cancelled'
              -- never sent for preparation and older than 3 days: the customer
              -- didn't confirm, so it was never shipped
              when o.sent_to_picker_at is null and o.created_at < now() - interval '3 days' then 'not_shipped'
              else 'open' end as outcome,
         o.total - coalesce(o.est_shipping, 0) as goods_revenue,
         coalesce(o.actual_shipping, 0) as courier_cost,
         o.cancel_stage, o.confirm_outcome
  from public.orders o
),
cost as (select order_id, sum(goods_cost) as goods_cost from agent.order_lines group by 1),
ads as (
  select date_trunc('month', spend_date)::date as month, sum(spend) as spend
  from public.meta_ad_spend_daily group by 1
),
per_month as (select month, count(*) as orders from o group by 1)
select o.*,
       coalesce(c.goods_cost, 0) as goods_cost,
       round(coalesce(a.spend, 0) / nullif(pm.orders, 0), 2) as ad_cost_share,
       round(coalesce(a.spend, 0) / nullif(pm.orders, 0) * 1.20, 2) as ad_cost_incl_buyer,
       case o.outcome
         when 'delivered' then round(o.goods_revenue - coalesce(c.goods_cost, 0) - o.courier_cost
                                     - 0.01 * (o.goods_revenue - o.courier_cost), 2)
         when 'returned'  then -o.courier_cost
         else 0 end as gross_profit,
       case o.outcome
         when 'delivered' then round(o.goods_revenue - coalesce(c.goods_cost, 0) - o.courier_cost
                                     - 0.01 * (o.goods_revenue - o.courier_cost)
                                     - coalesce(a.spend, 0) / nullif(pm.orders, 0) * 1.20, 2)
         when 'returned'  then round(-o.courier_cost - coalesce(a.spend, 0) / nullif(pm.orders, 0) * 1.20, 2)
         when 'cancelled'   then round(-coalesce(a.spend, 0) / nullif(pm.orders, 0) * 1.20, 2)
         when 'not_shipped' then round(-coalesce(a.spend, 0) / nullif(pm.orders, 0) * 1.20, 2)
         else null end as profit_after_ads
from o
left join cost c on c.order_id = o.order_id
left join ads a on a.month = o.month
left join per_month pm on pm.month = o.month;

-- ---------------------------------------------------------------------------
-- What goes out, what comes back, what earns — per product.
-- ---------------------------------------------------------------------------
create or replace view agent.product_performance as
select l.code,
       max(l.name) as name,
       max(l.brand) as brand,
       sum(l.qty) filter (where l.outcome = 'delivered') as units_delivered,
       sum(l.qty) filter (where l.outcome = 'returned')  as units_returned,
       round(100.0 * coalesce(sum(l.qty) filter (where l.outcome = 'returned'), 0)
             / nullif(sum(l.qty) filter (where l.outcome in ('delivered','returned')), 0), 1) as return_rate_pct,
       sum(l.qty) filter (where l.outcome = 'delivered' and l.order_date >= current_date - 30) as units_delivered_30d,
       sum(l.qty) filter (where l.outcome = 'delivered' and l.order_date >= current_date - 90) as units_delivered_90d,
       sum(l.revenue)    filter (where l.outcome = 'delivered') as revenue_delivered,
       sum(l.revenue - l.goods_cost) filter (where l.outcome = 'delivered') as goods_margin_delivered,
       round(100.0 * sum(l.revenue - l.goods_cost) filter (where l.outcome = 'delivered')
             / nullif(sum(l.revenue) filter (where l.outcome = 'delivered'), 0), 1) as goods_margin_pct,
       bool_or(l.from_combo) as ever_sold_in_combo,
       max(l.cost_source) as cost_source,
       p.price as current_price, p.qty as stock_qty, p.is_published,
       p.code is null as deleted_product
from agent.order_lines l
left join public.products p on p.code = l.code
group by l.code, p.code, p.price, p.qty, p.is_published;

-- ---------------------------------------------------------------------------
-- Marketing by week: spend vs what it produced.
-- ---------------------------------------------------------------------------
create or replace view agent.weekly_marketing as
with wk as (
  select date_trunc('week', order_date)::date as week,
         count(*) as orders,
         count(*) filter (where confirm_outcome in ('confirmed_button','confirmed_call')) as confirmed,
         count(*) filter (where confirm_outcome = 'no_answer') as no_answer,
         count(*) filter (where outcome = 'delivered') as delivered,
         count(*) filter (where outcome = 'returned') as returned,
         count(*) filter (where outcome = 'cancelled') as cancelled,
         count(*) filter (where outcome = 'not_shipped') as not_shipped,
         count(*) filter (where outcome = 'open') as still_open,
         sum(goods_revenue) filter (where outcome = 'delivered') as revenue_delivered,
         sum(gross_profit) as gross_profit
  from agent.order_economics group by 1
),
ads as (
  select date_trunc('week', spend_date)::date as week, sum(spend) as ad_spend
  from public.meta_ad_spend_daily group by 1
)
select coalesce(w.week, a.week) as week,
       coalesce(a.ad_spend, 0) as ad_spend,
       coalesce(w.orders, 0) as orders, w.confirmed, w.no_answer,
       w.delivered, w.returned, w.cancelled, w.not_shipped, w.still_open,
       round(coalesce(a.ad_spend, 0) / nullif(w.orders, 0), 0)    as ad_cost_per_order,
       round(coalesce(a.ad_spend, 0) / nullif(w.delivered, 0), 0) as ad_cost_per_delivered,
       w.revenue_delivered,
       round(coalesce(w.gross_profit, 0) - coalesce(a.ad_spend, 0) * 1.20, 0) as profit_after_ads
from wk w full join ads a on a.week = w.week;

-- ---------------------------------------------------------------------------
-- Orders still in progress (placed in the last 3 days, or sent for
-- preparation but not yet delivered/returned).
-- ---------------------------------------------------------------------------
create or replace view agent.open_orders as
select order_id, order_code, order_date,
       current_date - order_date as age_days,
       goods_revenue, confirm_outcome
from agent.order_economics
where outcome = 'open';

-- ---------------------------------------------------------------------------
-- Pricing base for the price researcher.
--   unit_cost        hard floor: never recommend a price below it.
--   order_overhead   what one delivered order costs beyond the goods
--                    (avg courier + ad spend incl. media buyer 20%, per
--                    delivered order, trailing 60 days).
--   standalone_profit  selling price − unit cost − order_overhead: profit if
--                    this product is the whole order. Negative on a cheap
--                    accessory is normal (it rides along with a bigger item);
--                    negative on a main product means it loses money alone.
-- ---------------------------------------------------------------------------
create or replace view agent.pricing_base as
with recent as (
  select avg(courier_cost) filter (where outcome = 'delivered') as avg_courier,
         count(*) filter (where outcome = 'delivered') as delivered
  from agent.order_economics where order_date >= current_date - 60
),
ads as (select sum(spend) as spend from public.meta_ad_spend_daily where spend_date >= current_date - 60)
select p.code, p.name, p.brand, p.category, p.is_published, p.qty as stock_qty,
       case when p.is_offer and p.offer_price > 0 then p.offer_price else p.price end as selling_price,
       uc.unit_cost, uc.cost_source,
       round((case when p.is_offer and p.offer_price > 0 then p.offer_price else p.price end) - uc.unit_cost, 2) as margin,
       round(100.0 * ((case when p.is_offer and p.offer_price > 0 then p.offer_price else p.price end) - uc.unit_cost)
             / nullif(case when p.is_offer and p.offer_price > 0 then p.offer_price else p.price end, 0), 1) as margin_pct,
       round(coalesce(r.avg_courier, 0) + coalesce(a.spend * 1.20 / nullif(r.delivered, 0), 0), 0) as order_overhead,
       round((case when p.is_offer and p.offer_price > 0 then p.offer_price else p.price end) - uc.unit_cost
             - coalesce(r.avg_courier, 0) - coalesce(a.spend * 1.20 / nullif(r.delivered, 0), 0), 0) as standalone_profit,
       pp.units_delivered_90d, pp.return_rate_pct
from public.products p
left join agent.unit_cost uc on uc.code = p.code
left join agent.product_performance pp on pp.code = p.code
cross join recent r cross join ads a;

-- ---------------------------------------------------------------------------
-- Confirmation test: do orders shipped WITHOUT confirmation pay off?
-- Groups every order sent to prep since tracking began (confirmed_at_prep set):
--   confirmed_first   customer confirmed before it went to prep
--   confirmed_later   shipped unconfirmed, customer confirmed afterwards
--   never_responded   shipped unconfirmed, customer never confirmed or cancelled
--   cancelled_after   shipped unconfirmed, customer cancelled after prep
-- Break-even for the unconfirmed groups: delivered share must beat
-- avg return courier / (avg delivered profit + avg return courier) — shown
-- per row from the same period's own averages.
-- ---------------------------------------------------------------------------
create or replace view agent.confirmation_test as
with shipped as (
  select o.id, o.confirmed_at_prep,
         case when o.confirmed_at_prep then 'confirmed_first'
              when o.customer_confirmed is true then 'confirmed_later'
              when o.customer_confirmed is false or o.post_prep_cancel_at is not null then 'cancelled_after'
              else 'never_responded' end as grp,
         e.outcome, e.gross_profit, e.courier_cost
  from public.orders o
  join agent.order_economics e on e.order_id = o.id
  where o.confirmed_at_prep is not null
),
avgs as (
  select avg(gross_profit) filter (where outcome = 'delivered') as avg_delivered_profit,
         avg(courier_cost) filter (where outcome = 'returned')  as avg_return_courier
  from agent.order_economics
)
select s.grp,
       count(*) as shipped,
       count(*) filter (where s.outcome = 'delivered') as delivered,
       count(*) filter (where s.outcome = 'returned')  as returned,
       count(*) filter (where s.outcome = 'cancelled') as cancelled,
       count(*) filter (where s.outcome in ('open','not_shipped')) as in_progress,
       round(100.0 * count(*) filter (where s.outcome = 'delivered')
             / nullif(count(*) filter (where s.outcome in ('delivered','returned')), 0), 1) as delivered_pct,
       round(100.0 * a.avg_return_courier / nullif(a.avg_delivered_profit + a.avg_return_courier, 0), 1) as break_even_delivered_pct,
       round(sum(s.gross_profit) filter (where s.outcome in ('delivered','returned')), 0) as profit_before_ads
from shipped s cross join avgs a
group by s.grp, a.avg_delivered_profit, a.avg_return_courier;
