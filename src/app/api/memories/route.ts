import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { embedText } from "@/lib/ai/memory-engine";

const createMemorySchema = z.object({
  companionId: z.string().uuid().nullable().optional(),
  category: z.enum(["identity", "interest", "relationship", "work_study", "event", "preference"]),
  fact: z.string().trim().min(2).max(500),
  importance: z.number().int().min(1).max(5).default(3),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

const patchMemorySchema = z.object({
  id: z.string().uuid(),
  fact: z.string().trim().min(2).max(500).optional(),
  category: z
    .enum(["identity", "interest", "relationship", "work_study", "event", "preference"])
    .optional(),
  importance: z.number().int().min(1).max(5).optional(),
  eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const companionId = searchParams.get("companionId");

  let query = supabase
    .from("memories")
    .select("id, user_id, companion_id, category, fact, importance, status, event_date, created_at")
    .eq("status", "active")
    .order("importance", { ascending: false })
    .order("created_at", { ascending: false });

  if (companionId) {
    query = query.or(`companion_id.eq.${companionId},companion_id.is.null`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Failed to load memories" }, { status: 500 });
  return NextResponse.json({ memories: data ?? [] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createMemorySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid memory payload" }, { status: 400 });

  const embedding = await embedText(`[${parsed.data.category}] ${parsed.data.fact}`);

  const { data, error } = await supabase
    .from("memories")
    .insert({
      user_id: user.id,
      companion_id: parsed.data.companionId ?? null,
      category: parsed.data.category,
      fact: parsed.data.fact,
      importance: parsed.data.importance,
      event_date: parsed.data.eventDate ?? null,
      embedding: embedding ? JSON.stringify(embedding) : null,
    })
    .select("id, user_id, companion_id, category, fact, importance, status, event_date, created_at")
    .single();

  if (error) return NextResponse.json({ error: "Failed to save memory" }, { status: 500 });
  return NextResponse.json({ memory: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = patchMemorySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid update payload" }, { status: 400 });

  const { id, eventDate, ...rest } = parsed.data;
  const updatePayload: Record<string, unknown> = { ...rest };
  if (eventDate !== undefined) updatePayload.event_date = eventDate;
  if (rest.fact) {
    const embedding = await embedText(`[${rest.category ?? "memory"}] ${rest.fact}`);
    if (embedding) updatePayload.embedding = JSON.stringify(embedding);
  }

  const { data, error } = await supabase
    .from("memories")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, user_id, companion_id, category, fact, importance, status, event_date, created_at")
    .single();

  if (error || !data) return NextResponse.json({ error: "Memory not found" }, { status: 404 });
  return NextResponse.json({ memory: data });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing memory id" }, { status: 400 });

  const { error } = await supabase
    .from("memories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: "Failed to delete memory" }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
