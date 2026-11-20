import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const profilePatchSchema = z.object({
  display_name: z.string().trim().min(1).max(60).optional(),
  birth_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  timezone: z.string().min(1).max(80).optional(),
  theme: z.enum(["light", "dark", "system"]).optional(),
  proactive_enabled: z.boolean().optional(),
  proactive_frequency: z.enum(["off", "low", "balanced", "high"]).optional(),
  quiet_hours_start: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  quiet_hours_end: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  voice_speed: z.number().min(0.7).max(1.4).optional(),
  allow_anonymized_training: z.boolean().optional(),
});

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error || !data) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  return NextResponse.json({ profile: data });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = profilePatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid profile settings" }, { status: 400 });

  const { data, error } = await supabase
    .from("profiles")
    .update(parsed.data)
    .eq("id", user.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message || "Update failed" }, { status: 400 });
  return NextResponse.json({ profile: data });
}
