import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [profileRes, companionsRes, messagesRes, memoriesRes, usageRes, voiceRes] =
    await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("companions").select("*").eq("user_id", user.id),
      supabase
        .from("messages")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("memories")
        .select("id, companion_id, category, fact, importance, status, event_date, created_at")
        .eq("user_id", user.id),
      supabase.from("usage_daily").select("*").eq("user_id", user.id),
      supabase.from("voice_sessions").select("*").eq("user_id", user.id),
    ]);

  const exportPayload = {
    exported_at: new Date().toISOString(),
    gdpr_format_version: "1.0",
    account: { id: user.id, email: user.email },
    profile: profileRes.data,
    companions: companionsRes.data ?? [],
    memories: memoriesRes.data ?? [],
    messages: messagesRes.data ?? [],
    usage_daily: usageRes.data ?? [],
    voice_sessions: voiceRes.data ?? [],
  };

  return new NextResponse(JSON.stringify(exportPayload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="kindred-data-export-${new Date()
        .toISOString()
        .slice(0, 10)}.json"`,
    },
  });
}
