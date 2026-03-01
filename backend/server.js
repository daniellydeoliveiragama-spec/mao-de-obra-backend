const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const Stripe = require("stripe");

// ========================
// ENV
// ========================
const {
  DATABASE_URL,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  APP_URL
} = process.env;

if (!DATABASE_URL) throw new Error("DATABASE_URL não definida.");
if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY não definida.");
if (!STRIPE_WEBHOOK_SECRET) throw new Error("STRIPE_WEBHOOK_SECRET não definida.");
if (!APP_URL) throw new Error("APP_URL não definida.");

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// DB
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors({ origin: true }));

// ========================
// HELPERS DB / TIME
// ========================
function toIsoFromUnix(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
}

async function getPlanByCode(planCode) {
  const r = await pool.query(
    "select code, stripe_price_id, is_active from public.plans where code = $1 limit 1",
    [planCode]
  );
  return r.rows[0] || null;
}

async function getPlanCodeFromDbByStripeSub(stripeSubId) {
  const r = await pool.query(
    "select plan_code from public.subscriptions where stripe_subscription_id = $1 limit 1",
    [stripeSubId]
  );
  return r.rows[0]?.plan_code || null;
}

async function getUserIdByStripeCustomerId(stripeCustomerId) {
  const r = await pool.query(
    "select user_id from public.stripe_customers where stripe_customer_id = $1 limit 1",
    [stripeCustomerId]
  );
  return r.rows[0]?.user_id || null;
}

async function saveEventIfNew(event) {
  try {
    await pool.query(
      `insert into public.payment_events (provider, event_id, event_type, payload)
       values ($1, $2, $3, $4)`,
      ["stripe", event.id, event.type, event]
    );
    return true; // novo
  } catch (e) {
    if (e.code === "23505") return false; // duplicate (idempotência)
    throw e;
  }
}

async function upsertSubscriptionByStripeSub({
  userId,
  planCode,
  stripeSubId,
  stripeCustomerId,
  status,
  cps,
  cpe,
  cancelAtPeriodEnd
}) {
  await pool.query(
    `insert into public.subscriptions
      (user_id, plan_code, status, stripe_subscription_id, stripe_customer_id, current_period_start, current_period_end, cancel_at_period_end)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (stripe_subscription_id)
     do update set
       user_id = excluded.user_id,
       plan_code = excluded.plan_code,
       status = excluded.status,
       stripe_customer_id = excluded.stripe_customer_id,
       current_period_start = excluded.current_period_start,
       current_period_end = excluded.current_period_end,
       cancel_at_period_end = excluded.cancel_at_period_end,
       updated_at = now()`,
    [userId, planCode, status, stripeSubId, stripeCustomerId, cps, cpe, !!cancelAtPeriodEnd]
  );
}

// ========================
// WEBHOOK HANDLERS
// ========================
async function handleCheckoutSessionCompleted(session) {
  const userId = session.client_reference_id || session.metadata?.user_id;
  const planCode = session.metadata?.plan_code;

  if (!userId || !planCode || !session.subscription || !session.customer) return;

  const sub = await stripe.subscriptions.retrieve(session.subscription);

  await upsertSubscriptionByStripeSub({
    userId,
    planCode,
    stripeSubId: sub.id,
    stripeCustomerId: sub.customer,
    status: sub.status,
    cps: toIsoFromUnix(sub.current_period_start),
    cpe: toIsoFromUnix(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end
  });
}

async function handleInvoicePaid(invoice) {
  const stripeSubId = invoice.subscription;
  const stripeCustomerId = invoice.customer;
  if (!stripeSubId || !stripeCustomerId) return;

  const sub = await stripe.subscriptions.retrieve(stripeSubId);
  const userId = await getUserIdByStripeCustomerId(stripeCustomerId);
  if (!userId) return;

  const planCode =
    sub.metadata?.plan_code ||
    (await getPlanCodeFromDbByStripeSub(stripeSubId)) ||
    "basic";

  await upsertSubscriptionByStripeSub({
    userId,
    planCode,
    stripeSubId: sub.id,
    stripeCustomerId: sub.customer,
    status: sub.status,
    cps: toIsoFromUnix(sub.current_period_start),
    cpe: toIsoFromUnix(sub.current_period_end),
    cancelAtPeriodEnd: sub.cancel_at_period_end
  });
}

async function handleSubscriptionUpdated(subscription) {
  const stripeCustomerId = subscription.customer;
  const userId = await getUserIdByStripeCustomerId(stripeCustomerId);
  if (!userId) return;

  const planCode =
    subscription.metadata?.plan_code ||
    (await getPlanCodeFromDbByStripeSub(subscription.id)) ||
    "basic";

  await upsertSubscriptionByStripeSub({
    userId,
    planCode,
    stripeSubId: subscription.id,
    stripeCustomerId: subscription.customer,
    status: subscription.status,
    cps: toIsoFromUnix(subscription.current_period_start),
    cpe: toIsoFromUnix(subscription.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end
  });
}

async function handleSubscriptionDeleted(subscription) {
  const stripeCustomerId = subscription.customer;
  const userId = await getUserIdByStripeCustomerId(stripeCustomerId);
  if (!userId) return;

  const planCode =
    subscription.metadata?.plan_code ||
    (await getPlanCodeFromDbByStripeSub(subscription.id)) ||
    "basic";

  await upsertSubscriptionByStripeSub({
    userId,
    planCode,
    stripeSubId: subscription.id,
    stripeCustomerId: subscription.customer,
    status: "canceled",
    cps: toIsoFromUnix(subscription.current_period_start),
    cpe: toIsoFromUnix(subscription.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end
  });
}

// ========================
// WEBHOOK ROUTE (RAW BODY!)
// ========================
async function webhookHandler(req, res) {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
  req.body,
  sig,
  process.env.STRIPE_WEBHOOK_SECRET
);
  } catch (err) {
    console.error("❌ Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const isNew = await saveEventIfNew(event);
    if (!isNew) return res.status(200).json({ received: true, duplicated: true });

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(event.data.object);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(event.data.object);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object);
        break;
      default:
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error("❌ Error processing webhook:", err);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}

// IMPORTANTE: webhook precisa vir ANTES do express.json()
app.post("/billing/webhook", express.raw({ type: "application/json" }), webhookHandler);
app.post("/webhook", express.raw({ type: "application/json" }), webhookHandler);

// ========================
// JSON routes (depois do webhook)
// ========================
app.use(express.json());

// ========================
// BASE ROUTES
// ========================
app.get("/", (req, res) => res.send("API do App Mão de Obra rodando ✅"));

app.get("/health", (req, res) => res.json({ ok: true, message: "Servidor rodando" }));

app.get("/db-test", async (req, res) => {
  const r = await pool.query("select now() as now");
  res.json({ ok: true, now: r.rows[0].now });
});

// ========================
// CHECKOUT (principal + alias)
// ========================
async function checkoutHandler(req, res) {
  try {
    const { user_id, email, plan_code } = req.body || {};

    if (!user_id || !email || !plan_code) {
      return res.status(400).json({ error: "Campos obrigatórios: user_id, email, plan_code" });
    }

    const plan = await getPlanByCode(plan_code);
    if (!plan || !plan.is_active || !plan.stripe_price_id) {
      return res.status(400).json({ error: "Plano inválido/inativo ou sem stripe_price_id" });
    }

    // 1) customer (reuse ou cria)
    const existing = await pool.query(
      "select stripe_customer_id from public.stripe_customers where user_id = $1 limit 1",
      [user_id]
    );

    let stripeCustomerId = existing.rows[0]?.stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { user_id }
      });

      stripeCustomerId = customer.id;

      await pool.query(
        `insert into public.stripe_customers (user_id, email, stripe_customer_id)
         values ($1, $2, $3)
         on conflict (user_id)
         do update set email = excluded.email, stripe_customer_id = excluded.stripe_customer_id`,
        [user_id, email, stripeCustomerId]
      );
    }

    // 2) checkout session subscription
    const successUrl = `${APP_URL}/assinatura-retorno.html?success=1&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${APP_URL}/assinatura-retorno.html?canceled=1`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user_id,
      metadata: { user_id, plan_code }
    });

    return res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("❌ /billing/checkout error:", err);
    return res.status(500).json({ error: "Erro ao criar checkout" });
  }
}

app.post("/billing/checkout", checkoutHandler);
app.post("/checkout", checkoutHandler);

// ========================
// STATUS (principal)
// ========================
app.get("/billing/status", async (req, res) => {
  const user_id = req.query.user_id;

  if (!user_id) return res.status(400).json({ error: "user_id obrigatório" });

  const r = await pool.query(
    `select plan_code, status, current_period_end, cancel_at_period_end, updated_at
     from public.subscriptions
     where user_id = $1
     order by updated_at desc
     limit 1`,
    [user_id]
  );

  const sub = r.rows[0] || null;

  const now = new Date();
  const validUntil = sub?.current_period_end ? new Date(sub.current_period_end) : null;
  const isActive = sub?.status === "active" && validUntil && validUntil > now;

  return res.json({ subscription: sub, isActive });
});

// ========================
// START
// ========================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));