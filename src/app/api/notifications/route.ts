import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("messages")
    .select("id, companion_id, content, created_at, companions(name, archetype_slug)")
    .eq("user_id", user.id)
    .eq("is_proactive", true)
    .order("created_at", { ascending: false })
    .limit(40);

  if (error) return NextResponse.json({ error: "Failed to load notifications" }, { status: 500 });
  return NextResponse.json({ notifications: data ?? [] });
}
