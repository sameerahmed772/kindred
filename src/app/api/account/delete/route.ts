import crypto from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/billing/stripe";

const deleteSchema = z.object({ confirmation: z.literal("DELETE MY ACCOUNT") });

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Please confirm by sending { "confirmation": "DELETE MY ACCOUNT" }.' },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_subscription_id")
    .eq("id", user.id)
    .single();

  let stripeCanceled = false;
  if (profile?.stripe_subscription_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = getStripeClient();
      await stripe.subscriptions.cancel(profile.stripe_subscription_id);
      stripeCanceled = true;
    } catch (err) {
      console.error("Failed to cancel Stripe subscription during deletion:", err);
    }
  }

  const { error: deleteErr } = await admin.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    return NextResponse.json({ error: "Failed to permanently delete account" }, { status: 500 });
  }

  const userHash = crypto.createHash("sha256").update(user.id).digest("hex");
  await admin.from("deletion_audit_logs").insert({
    user_hash: userHash,
    stripe_canceled: stripeCanceled,
  });

  await supabase.auth.signOut();
  return NextResponse.json({ deleted: true, stripeCanceled });
}
