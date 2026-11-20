import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redactPII } from "@/lib/ai/pii-redactor";

const reactionSchema = z.object({
  reaction: z.enum(["love", "laugh", "up", "down"]).nullable(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = reactionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid reaction" }, { status: 400 });

  const { data: msg, error } = await supabase
    .from("messages")
    .update({ user_reaction: parsed.data.reaction })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, companion_id, content, prompt_version_id")
    .single();

  if (error || !msg) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  if (parsed.data.reaction && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const [profileRes, compRes] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, allow_anonymized_training")
        .eq("id", user.id)
        .single(),
      supabase.from("companions").select("archetype_slug, name").eq("id", msg.companion_id).single(),
    ]);

    if (profileRes.data?.allow_anonymized_training && compRes.data) {
      const redacted = redactPII(msg.content, [profileRes.data.display_name, compRes.data.name]);
      if (redacted.verifiedClean) {
        const admin = createAdminClient();
        await admin.from("training_candidates").insert({
          archetype_slug: compRes.data.archetype_slug,
          prompt_version_id: msg.prompt_version_id ?? null,
          sanitized_context: { source: "reaction_feedback" },
          chosen_reply: parsed.data.reaction !== "down" ? redacted.sanitized : null,
          rejected_reply: parsed.data.reaction === "down" ? redacted.sanitized : null,
          signal_type: parsed.data.reaction,
          pii_verified_clean: true,
        });
      }
    }
  }

  return NextResponse.json({ message: msg });
}
