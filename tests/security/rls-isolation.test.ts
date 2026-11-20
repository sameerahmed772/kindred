import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const userAEmail = process.env.TEST_USER_A_EMAIL;
const userAPass = process.env.TEST_USER_A_PASSWORD;
const userBEmail = process.env.TEST_USER_B_EMAIL;
const userBPass = process.env.TEST_USER_B_PASSWORD;

const canRunLive = Boolean(url && key && userAEmail && userAPass && userBEmail && userBPass);

describe.skipIf(!canRunLive)("Supabase RLS & Billing Tamper Isolation", () => {
  it("prevents cross-tenant reads and blocks client plan_tier escalation", async () => {
    const clientA = createClient(url!, key!);
    const clientB = createClient(url!, key!);

    const { data: authA, error: errA } = await clientA.auth.signInWithPassword({
      email: userAEmail!,
      password: userAPass!,
    });
    expect(errA).toBeNull();

    const { data: authB, error: errB } = await clientB.auth.signInWithPassword({
      email: userBEmail!,
      password: userBPass!,
    });
    expect(errB).toBeNull();

    const { data: compA, error: createErr } = await clientA
      .from("companions")
      .insert({
        user_id: authA.user!.id,
        archetype_slug: "funny-playful",
        name: "RLS-Test-Companion",
        gender: "female",
        personality_summary: "Witty",
        communication_style: "Casual",
        backstory: "Security test companion",
      })
      .select("id")
      .single();

    expect(createErr).toBeNull();
    expect(compA?.id).toBeTruthy();

    // User B must receive 0 rows when querying User A's companion
    const { data: leaked } = await clientB
      .from("companions")
      .select("*")
      .eq("id", compA!.id);
    expect(leaked).toEqual([]);

    // User B must be blocked by DB trigger from self-upgrading to pro
    const { error: billingErr } = await clientB
      .from("profiles")
      .update({ plan_tier: "pro" })
      .eq("id", authB.user!.id);
    expect(billingErr).not.toBeNull();

    // Cleanup
    await clientA.from("companions").delete().eq("id", compA!.id);
  });
});
