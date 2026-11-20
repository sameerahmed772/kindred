import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { KindredWorkspace } from "@/components/kindred/KindredWorkspace";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [profileRes, companionsRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).single(),
    supabase
      .from("companions")
      .select("*")
      .eq("user_id", user.id)
      .order("last_interaction_at", { ascending: false }),
  ]);

  const profile = profileRes.data ?? {
    id: user.id,
    display_name: user.email?.split("@")[0] ?? "Friend",
    birth_date: null,
    is_age_verified: false,
    ai_disclosure_accepted_at: null,
    timezone: "UTC",
    plan_tier: "free" as const,
    subscription_status: "inactive",
    theme: "dark" as const,
    proactive_enabled: true,
    proactive_frequency: "balanced" as const,
    quiet_hours_start: "23:00",
    quiet_hours_end: "08:00",
    voice_speed: 1.0,
    allow_anonymized_training: false,
  };

  return (
    <KindredWorkspace
      initialProfile={profile}
      initialCompanions={companionsRes.data ?? []}
    />
  );
}
