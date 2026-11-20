import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env";

let configured = false;

function ensureVapidConfigured(): boolean {
  if (configured) return true;
  const env = getServerEnv();
  if (!env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    return false;
  }
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  configured = true;
  return true;
}

export async function sendWebPushToUser(params: {
  supabase: SupabaseClient;
  userId: string;
  title: string;
  body: string;
  url?: string;
}): Promise<boolean> {
  if (!ensureVapidConfigured()) return false;

  const { data: subs } = await params.supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", params.userId);

  if (!subs || subs.length === 0) return false;

  let anySent = false;
  const payload = JSON.stringify({
    title: params.title,
    body: params.body,
    url: params.url ?? "/",
    badge: "Kindred AI",
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      anySent = true;
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await params.supabase.from("push_subscriptions").delete().eq("id", sub.id);
      }
    }
  }

  return anySent;
}
