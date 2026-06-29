# 📲 WhatsApp Order Confirmation (Confirm / Cancel buttons) — Setup

This adds an automatic WhatsApp message to the customer right after they order, with two
buttons **تأكيد الحجز** and **إلغاء الحجز**. When they tap one, the order updates itself
in your dashboard (`customer_confirmed = true`, or status → `Cancelled`).

The code is built (`api/wa-confirm.js` sends it, `api/wa-webhook.js` receives the reply).
It stays **off** until you finish the Meta setup below and add the env vars.

---

## Part A — Meta WhatsApp Business setup (your part; this is the slow step)
> Templates with buttons must be **approved by Meta** — that can take from minutes to a
> day or two. Start this early.

1. Create a **Meta Business account** and verify your business: https://business.facebook.com
2. Go to **Meta for Developers** → create an app → add the **WhatsApp** product:
   https://developers.facebook.com
3. Add a **phone number** to WhatsApp Business (⚠️ it must NOT be in use on the normal
   WhatsApp app — use a fresh/dedicated number). Copy:
   - **Phone Number ID**
   - **WhatsApp Business Account (WABA) ID**
4. Create a **permanent access token** (Business Settings → System Users → add a system
   user with admin on the WhatsApp asset → Generate token with `whatsapp_business_messaging`
   + `whatsapp_business_management`). Copy it.
5. Create the **message template** (WhatsApp Manager → Templates → Create):
   - **Name:** `order_confirm`  (lowercase, must match `WA_TEMPLATE_NAME`)
   - **Category:** Utility
   - **Language:** Arabic — `ar`
   - **Body** (3 variables, in this order):
     ```
     أهلاً {{1}} 👋 شكراً لطلبك من بروتيك 🛠️
     طلبك رقم {{2}} بإجمالي {{3}} ج.م (دفع عند الاستلام).
     برجاء تأكيد الحجز 👇
     ```
   - **Buttons:** type **Quick Reply**, add two:
     1. `تأكيد الحجز`
     2. `إلغاء الحجز`
   - Submit for approval. Wait until status = **Approved**.
6. Set up the **webhook** (WhatsApp → Configuration):
   - **Callback URL:** `https://protech-stores.vercel.app/api/wa-webhook`
   - **Verify token:** any random string (you'll paste the same one into `WA_VERIFY_TOKEN`)
   - Subscribe to the **messages** field.

## Part B — Vercel env vars (your part)
Vercel → Protech-Stores → Environments → Production → Environment Variables, add:

| Name | Value |
|------|-------|
| `WA_TOKEN` | the permanent access token from step A4 |
| `WA_PHONE_NUMBER_ID` | the Phone Number ID from step A3 |
| `WA_TEMPLATE_NAME` | `order_confirm` |
| `WA_TEMPLATE_LANG` | `ar` |
| `WA_VERIFY_TOKEN` | the random string you used in the webhook (step A6) |
| `SUPABASE_KEY` | (already set) must be the **secret** key |
| `SUPABASE_URL` | (already set) |

Redeploy after saving.

## Part C — Database columns (run once in Supabase → SQL Editor)
```sql
alter table orders add column if not exists wa_msg_id text;
alter table orders add column if not exists customer_confirmed boolean;
```

## Part D — Go live
Once the template is **Approved**, the env vars are set, and the SQL has run, tell me and
I'll merge the branch to `main`. Then a new order will auto-send the confirm/cancel message,
and tapping a button updates the order in your dashboard.

> Heads-up: WhatsApp Business API charges a small fee per conversation. And until the
> template is approved, no message can be sent — that approval is the gating step.
