import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const updateCompanionSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  personality_summary: z.string().trim().min(5).max(500).optional(),
  communication_style: z.string().trim().min(5).max(500).optional(),
  backstory: z.string().trim().min(5).max(1500).optional(),
  interests: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  voice_id: z.string().min(1).max(40).optional(),
  chat_theme: z.string().min(1).max(40).optional(),
  romantic_consent_enabled: z.boolean().optional(),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [compRes, msgsRes] = await Promise.all([
    supabase.from("companions").select("*").eq("id", id).eq("user_id", user.id).single(),
    supabase
      .from("messages")
      .select("*")
      .eq("companion_id", id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  if (compRes.error || !compRes.data) {
    return NextResponse.json({ error: "Companion not found" }, { status: 404 });
  }

  return NextResponse.json({ companion: compRes.data, messages: msgsRes.data ?? [] });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateCompanionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("companions")
    .update(parsed.data)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message || "Failed to update companion" }, { status: 400 });
  }

  return NextResponse.json({ companion: data });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("companions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Failed to delete companion" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
