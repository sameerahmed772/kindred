import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { getStripeClient } from "@/lib/billing/stripe";

const checkoutSchema = z.object({ plan: z.enum(["plus", "pro"]) });

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });

  const env = getServerEnv();
  const priceId = parsed.data.plan === "pro" ? env.STRIPE_PRICE_PRO : env.STRIPE_PRICE_PLUS;
  if (!priceId) {
    return NextResponse.json({ error: "Stripe price ID is not configured." }, { status: 503 });
  }

  const stripe = getStripeClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, display_name")
    .eq("id", user.id)
    .single();

  let customerId = profile?.stripe_customer_id ?? undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
      name: profile?.display_name ?? undefined,
      metadata: { supabase_user_id: user.id },
    });
    customerId = customer.id;
    const admin = createAdminClient();
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    allow_promotion_codes: true,
    metadata: { supabase_user_id: user.id, target_plan: parsed.data.plan },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/?billing=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/?billing=canceled`,
  });

  return NextResponse.json({ url: session.url });
}
