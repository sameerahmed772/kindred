"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageCircle,
  Compass,
  Brain,
  Bell,
  Settings,
  User,
  Send,
  Phone,
  Mic,
  Volume2,
  Sparkles,
  Heart,
  ThumbsUp,
  ThumbsDown,
  Laugh,
  Plus,
  Trash2,
  Download,
  LogOut,
  ShieldCheck,
  Crown,
  Palette,
  Loader2,
  Check,
  X,
} from "lucide-react";
import type { ChatMessage, Companion, Gender, MemoryCategory, MemoryItem, ReactionType, UserProfile } from "@/lib/types";
import { CHAT_THEMES, COMPANION_ARCHETYPES, RELATIONSHIP_STAGES } from "@/lib/catalog/archetypes";
import { EU_AI_ACT_DISCLOSURE } from "@/lib/ai/safety";
import { streamCompanionChat } from "@/lib/api/stream-chat";
import { createClient } from "@/lib/supabase/client";
import { initPostHog, trackEvent } from "@/lib/analytics/posthog";
import { VoiceCallModal } from "./VoiceCallModal";

type ActiveTab = "home" | "discover" | "chat" | "profile" | "notifications" | "memories" | "settings";

interface ProactiveNotif {
  id: string;
  companion_id: string;
  content: string;
  created_at: string;
  companions?: { name: string; archetype_slug: string } | null;
}

export function KindredWorkspace({
  initialProfile,
  initialCompanions,
}: {
  initialProfile: UserProfile;
  initialCompanions: Companion[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<ActiveTab>(initialCompanions.length > 0 ? "chat" : "discover");
  const [profile, setProfile] = useState<UserProfile>(initialProfile);
  const [companions, setCompanions] = useState<Companion[]>(initialCompanions);
  const [activeCompanionId, setActiveCompanionId] = useState<string | null>(
    initialCompanions[0]?.id ?? null
  );

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingChat, setLoadingChat] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [quotaInfo, setQuotaInfo] = useState<{ used: number; limit: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [voiceModalOpen, setVoiceModalOpen] = useState(false);
  const [dictating, setDictating] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Discover & Studio state
  const [genderFilter, setGenderFilter] = useState<"all" | Gender>("all");
  const [studioOpen, setStudioOpen] = useState(false);
  const [customForm, setCustomForm] = useState({
    name: "",
    gender: "female" as Gender,
    age: 25,
    personalitySummary: "",
    communicationStyle: "Warm, playful, natural casual texting.",
    backstory: "",
    interests: "Music, Late-night coffee, Cinema",
    voiceId: "Aoede",
  });
  const [creatingCompanion, setCreatingCompanion] = useState(false);

  // Memories & Notifications state
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [newMem, setNewMem] = useState({
    category: "interest" as MemoryCategory,
    fact: "",
    importance: 3,
    eventDate: "",
  });
  const [notifications, setNotifications] = useState<ProactiveNotif[]>([]);
  const [triggeringProactive, setTriggeringProactive] = useState(false);

  // Settings / GDPR state
  const [savingSettings, setSavingSettings] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [billingLoading, setBillingLoading] = useState<string | null>(null);

  const activeCompanion = useMemo(
    () => companions.find((c) => c.id === activeCompanionId) ?? companions[0] ?? null,
    [companions, activeCompanionId]
  );

  useEffect(() => {
    initPostHog();
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => null);
    }
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (activeCompanion?.id) {
      void loadCompanionChat(activeCompanion.id);
    }
  }, [activeCompanion?.id]);

  useEffect(() => {
    if (tab === "memories") void loadMemories();
    if (tab === "notifications") void loadNotifications();
  }, [tab]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function loadCompanionChat(id: string) {
    setLoadingChat(true);
    try {
      const res = await fetch(`/api/companions/${id}`);
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages ?? []);
      if (data.companion) {
        setCompanions((prev) => prev.map((c) => (c.id === id ? data.companion : c)));
      }
    } finally {
      setLoadingChat(false);
    }
  }

  async function loadMemories() {
    const res = await fetch("/api/memories");
    if (res.ok) {
      const data = await res.json();
      setMemories(data.memories ?? []);
    }
  }

  async function loadNotifications() {
    const res = await fetch("/api/notifications");
    if (res.ok) {
      const data = await res.json();
      setNotifications(data.notifications ?? []);
    }
  }

  async function handleSendMessage(e?: React.FormEvent) {
    e?.preventDefault();
    if (!activeCompanion || !draft.trim() || streaming) return;

    const text = draft.trim();
    setDraft("");
    setStreaming(true);

    const tempUserId = `temp-user-${Date.now()}`;
    const tempAiId = `temp-ai-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: tempUserId,
        user_id: profile.id,
        companion_id: activeCompanion.id,
        role: "user",
        modality: "text",
        content: text,
        is_proactive: false,
        created_at: new Date().toISOString(),
      },
      {
        id: tempAiId,
        user_id: profile.id,
        companion_id: activeCompanion.id,
        role: "assistant",
        modality: "text",
        content: "",
        is_proactive: false,
        created_at: new Date().toISOString(),
      },
    ]);

    trackEvent("chat_message_sent", { archetype: activeCompanion.archetype_slug });

    await streamCompanionChat(
      { companionId: activeCompanion.id, content: text },
      {
        onMeta: (meta) => {
          setQuotaInfo({ used: meta.usedToday, limit: meta.dailyLimit });
          setMessages((prev) =>
            prev.map((m) => (m.id === tempUserId ? { ...m, id: meta.userMessageId } : m))
          );
        },
        onDelta: (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempAiId ? { ...m, content: m.content + chunk } : m))
          );
        },
        onDone: (done) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempAiId && done.assistantMessageId
                ? { ...m, id: done.assistantMessageId }
                : m
            )
          );
          setCompanions((prev) =>
            prev.map((c) =>
              c.id === activeCompanion.id
                ? {
                    ...c,
                    affinity_score: done.affinityScore,
                    relationship_stage: done.relationshipStage,
                    last_interaction_at: new Date().toISOString(),
                  }
                : c
            )
          );
        },
        onError: (err) => {
          setToast(err.message);
          setMessages((prev) => prev.filter((m) => m.id !== tempAiId));
        },
      }
    );

    setStreaming(false);
  }

  async function handleReaction(messageId: string, reaction: ReactionType) {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, user_reaction: reaction } : m))
    );
    await fetch(`/api/messages/${messageId}/reaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reaction }),
    });
  }

  function speakText(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = profile.voice_speed || 1.0;
    window.speechSynthesis.speak(u);
  }

  function toggleDictation() {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      setToast("Browser voice dictation is not supported in this browser.");
      return;
    }
    const rec = new SR();
    rec.lang = "en-US";
    rec.onstart = () => setDictating(true);
    rec.onend = () => setDictating(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = e.results?.[0]?.[0]?.transcript;
      if (transcript) setDraft((d) => (d ? `${d} ${transcript}` : transcript));
    };
    rec.start();
  }

  async function handleAddArchetype(slug: string) {
    const arch = COMPANION_ARCHETYPES.find((a) => a.slug === slug);
    if (!arch) return;
    setCreatingCompanion(true);
    try {
      const res = await fetch("/api/companions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetypeSlug: arch.slug,
          name: arch.name,
          gender: arch.gender,
          age: arch.age,
          personalitySummary: arch.personalitySummary,
          communicationStyle: arch.communicationStyle,
          backstory: arch.backstory,
          interests: arch.interests,
          voiceId: arch.voiceId,
          chatTheme: arch.chatTheme,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error || "Could not add companion.");
        return;
      }
      setCompanions((prev) => [data.companion, ...prev]);
      setActiveCompanionId(data.companion.id);
      setTab("chat");
      setToast(`${data.companion.name} joined your chats.`);
    } finally {
      setCreatingCompanion(false);
    }
  }

  async function handleCreateCustomCompanion(e: React.FormEvent) {
    e.preventDefault();
    setCreatingCompanion(true);
    try {
      const res = await fetch("/api/companions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          archetypeSlug: "custom-studio",
          name: customForm.name,
          gender: customForm.gender,
          age: Number(customForm.age),
          personalitySummary: customForm.personalitySummary,
          communicationStyle: customForm.communicationStyle,
          backstory: customForm.backstory,
          interests: customForm.interests
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          voiceId: customForm.voiceId,
          chatTheme: "midnight",
          isCustom: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error || "Failed to create custom companion.");
        return;
      }
      setCompanions((prev) => [data.companion, ...prev]);
      setActiveCompanionId(data.companion.id);
      setStudioOpen(false);
      setTab("chat");
      setToast(`Created ${data.companion.name}.`);
    } finally {
      setCreatingCompanion(false);
    }
  }

  async function updateCompanionField(patch: Record<string, unknown>) {
    if (!activeCompanion) return;
    const res = await fetch(`/api/companions/${activeCompanion.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setToast(data.error || "Update failed.");
      return;
    }
    setCompanions((prev) => prev.map((c) => (c.id === activeCompanion.id ? data.companion : c)));
    setToast("Companion updated.");
  }

  async function handleAddMemory(e: React.FormEvent) {
    e.preventDefault();
    if (!newMem.fact.trim()) return;
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companionId: activeCompanion?.id ?? null,
        category: newMem.category,
        fact: newMem.fact.trim(),
        importance: newMem.importance,
        eventDate: newMem.eventDate || null,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      setMemories((prev) => [data.memory, ...prev]);
      setNewMem({ category: "interest", fact: "", importance: 3, eventDate: "" });
      setToast("Memory indexed with semantic vector embedding.");
    }
  }

  async function handleDeleteMemory(id: string) {
    const res = await fetch(`/api/memories?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setMemories((prev) => prev.filter((m) => m.id !== id));
    }
  }

  async function handleTriggerProactive() {
    if (!activeCompanion) return;
    setTriggeringProactive(true);
    try {
      const res = await fetch("/api/proactive/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companionId: activeCompanion.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error || "Could not trigger check-in.");
        return;
      }
      await loadNotifications();
      await loadCompanionChat(activeCompanion.id);
      setToast(`${activeCompanion.name} sent a contextual check-in.`);
    } finally {
      setTriggeringProactive(false);
    }
  }

  async function handleSaveSettings(patch: Partial<UserProfile>) {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast(data.error || "Failed to save settings.");
        return;
      }
      setProfile(data.profile);
      setToast("Settings saved.");
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleStripeCheckout(plan: "plus" | "pro") {
    setBillingLoading(plan);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setToast(data.error || "Stripe Checkout unavailable. Check STRIPE_* env vars.");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBillingLoading(null);
    }
  }

  async function handleStripePortal() {
    setBillingLoading("portal");
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setToast(data.error || "Billing portal unavailable.");
        return;
      }
      window.location.href = data.url;
    } finally {
      setBillingLoading(null);
    }
  }

  async function handleDeleteAccount() {
    const res = await fetch("/api/account/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: deleteConfirm }),
    });
    const data = await res.json();
    if (!res.ok) {
      setToast(data.error || "Deletion failed.");
      return;
    }
    router.push("/login");
    router.refresh();
  }

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const isLight = profile.theme === "light";
  const themeDef = CHAT_THEMES[activeCompanion?.chat_theme ?? "midnight"] ?? CHAT_THEMES.midnight;

  const navItems: Array<{ id: ActiveTab; label: string; icon: typeof MessageCircle }> = [
    { id: "home", label: "Home", icon: MessageCircle },
    { id: "discover", label: "Discover", icon: Compass },
    { id: "chat", label: "Chat", icon: Sparkles },
    { id: "profile", label: "Profile", icon: User },
    { id: "notifications", label: "Check-Ins", icon: Bell },
    { id: "memories", label: "Memories", icon: Brain },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <div
      className={`min-h-screen flex flex-col md:flex-row ${
        isLight ? "bg-slate-50 text-slate-900" : "bg-[#0B0D12] text-slate-100"
      }`}
    >
      {/* Desktop Sidebar Rail */}
      <aside
        className={`hidden md:flex md:w-64 flex-col border-r p-4 ${
          isLight ? "border-slate-200 bg-white" : "border-white/10 bg-[#10131C]"
        }`}
      >
        <div className="flex items-center gap-2.5 px-2 mb-6">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center">
            <Heart className="h-4 w-4 text-white" />
          </div>
          <div>
            <div className="font-bold tracking-tight">Kindred</div>
            <div className="text-[11px] uppercase tracking-wider text-indigo-400 font-semibold">
              {profile.plan_tier} plan
            </div>
          </div>
        </div>

        <nav className="space-y-1 flex-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : isLight
                      ? "text-slate-600 hover:bg-slate-100"
                      : "text-slate-400 hover:bg-white/5 hover:text-white"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-slate-400 hover:text-rose-400 transition"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </button>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0">
        {toast && (
          <div className="fixed top-4 right-4 z-50 flex items-center gap-2 rounded-2xl border border-indigo-500/30 bg-[#171B29] px-4 py-3 text-xs text-slate-100 shadow-2xl">
            <Sparkles className="h-4 w-4 text-indigo-400" />
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)}>
              <X className="h-3.5 w-3.5 text-slate-400" />
            </button>
          </div>
        )}

        {/* SCREEN 1: HOME (COMPANIONS LIST) */}
        {tab === "home" && (
          <section className="max-w-4xl w-full mx-auto p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Welcome back, {profile.display_name}</h1>
                <p className="text-xs text-slate-400 mt-1">{EU_AI_ACT_DISCLOSURE}</p>
              </div>
              <button
                type="button"
                onClick={() => setTab("discover")}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white"
              >
                <Plus className="h-4 w-4" /> Find Companion
              </button>
            </div>

            {companions.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-10 text-center">
                <p className="text-sm text-slate-400 mb-4">
                  You haven&apos;t connected with any AI companions yet.
                </p>
                <button
                  type="button"
                  onClick={() => setTab("discover")}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Explore 10 Archetypes
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {companions.map((c) => {
                  const stage = RELATIONSHIP_STAGES[c.relationship_stage - 1] ?? RELATIONSHIP_STAGES[0];
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setActiveCompanionId(c.id);
                        setTab("chat");
                      }}
                      className="text-left rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-4 transition flex items-start gap-3.5"
                    >
                      <div className="h-12 w-12 shrink-0 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center font-bold text-white text-lg">
                        {c.name.slice(0, 1)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">{c.name}</span>
                          <span className="text-[10px] rounded-full bg-indigo-500/20 text-indigo-300 px-2 py-0.5">
                            {stage.label}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 line-clamp-2 mt-1">
                          {c.personality_summary}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* SCREEN 2: DISCOVER & CUSTOM COMPANION STUDIO */}
        {tab === "discover" && (
          <section className="max-w-6xl w-full mx-auto p-6 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold">Discover Companions</h1>
                <p className="text-xs text-slate-400">
                  Choose from 10 distinct adult AI personalities or craft your own.
                </p>
              </div>
              <div className="flex items-center gap-2">
                {(["all", "female", "male"] as const).map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => setGenderFilter(g)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-medium capitalize ${
                      genderFilter === g
                        ? "bg-indigo-600 text-white"
                        : "bg-white/5 text-slate-400 hover:text-white"
                    }`}
                  >
                    {g}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setStudioOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 px-3.5 py-1.5 text-xs font-semibold text-white"
                >
                  <Plus className="h-3.5 w-3.5" /> Custom Studio
                </button>
              </div>
            </div>

            {studioOpen && (
              <form
                onSubmit={handleCreateCustomCompanion}
                className="rounded-3xl border border-fuchsia-500/30 bg-fuchsia-500/5 p-5 grid gap-3 sm:grid-cols-2"
              >
                <input
                  required
                  placeholder="Companion Name"
                  value={customForm.name}
                  onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <select
                    value={customForm.gender}
                    onChange={(e) =>
                      setCustomForm({ ...customForm, gender: e.target.value as Gender })
                    }
                    className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  >
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                    <option value="non-binary">Non-binary</option>
                  </select>
                  <input
                    type="number"
                    min={18}
                    max={99}
                    value={customForm.age}
                    onChange={(e) => setCustomForm({ ...customForm, age: Number(e.target.value) })}
                    className="w-24 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                </div>
                <textarea
                  required
                  rows={2}
                  placeholder="Personality description..."
                  value={customForm.personalitySummary}
                  onChange={(e) =>
                    setCustomForm({ ...customForm, personalitySummary: e.target.value })
                  }
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm sm:col-span-2"
                />
                <textarea
                  required
                  rows={2}
                  placeholder="Backstory..."
                  value={customForm.backstory}
                  onChange={(e) => setCustomForm({ ...customForm, backstory: e.target.value })}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm sm:col-span-2"
                />
                <input
                  placeholder="Interests (comma-separated)"
                  value={customForm.interests}
                  onChange={(e) => setCustomForm({ ...customForm, interests: e.target.value })}
                  className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm sm:col-span-2"
                />
                <button
                  type="submit"
                  disabled={creatingCompanion}
                  className="sm:col-span-2 rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 py-2.5 text-sm font-semibold text-white"
                >
                  {creatingCompanion ? "Creating..." : "Create Custom Companion (Plus/Pro)"}
                </button>
              </form>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {COMPANION_ARCHETYPES.filter(
                (a) => genderFilter === "all" || a.gender === genderFilter
              ).map((arch) => (
                <div
                  key={arch.slug}
                  className="rounded-3xl border border-white/10 bg-[#13161F] p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <div
                        className={`h-12 w-12 rounded-2xl bg-gradient-to-br ${arch.accentGradient} flex items-center justify-center text-lg font-bold text-white`}
                      >
                        {arch.name.slice(0, 1)}
                      </div>
                      {arch.isPremium && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[10px] font-semibold text-amber-300">
                          <Crown className="h-3 w-3" /> Pro
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-base text-white">
                      {arch.name}, <span className="text-slate-400 font-normal">{arch.age}</span>
                    </h3>
                    <div className="text-xs font-medium text-indigo-400 mt-0.5">
                      {arch.personalityLabel}
                    </div>
                    <p className="text-xs text-slate-300 mt-2">{arch.tagline}</p>
                    <p className="text-[11px] text-slate-400 mt-2 line-clamp-3">{arch.backstory}</p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {arch.interests.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-slate-300"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={creatingCompanion}
                    onClick={() => handleAddArchetype(arch.slug)}
                    className="mt-4 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2.5 text-xs font-semibold text-white transition"
                  >
                    Start Relationship
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* SCREEN 3: REAL-TIME STREAMING CHAT */}
        {tab === "chat" && (
          <section className={`flex-1 flex flex-col h-[calc(100vh-4rem)] md:h-screen ${themeDef.surfaceClass}`}>
            {!activeCompanion ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <p className="text-sm text-slate-400 mb-3">Pick a companion to start chatting.</p>
                <button
                  type="button"
                  onClick={() => setTab("discover")}
                  className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white"
                >
                  Open Discover
                </button>
              </div>
            ) : (
              <>
                <header className="flex items-center justify-between border-b border-white/10 bg-black/30 backdrop-blur-md px-4 py-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center font-bold text-white">
                      {activeCompanion.name.slice(0, 1)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">
                          {activeCompanion.name}
                        </span>
                        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] text-indigo-300">
                          AI · Stage {activeCompanion.relationship_stage}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        {RELATIONSHIP_STAGES[activeCompanion.relationship_stage - 1]?.label} ·{" "}
                        {activeCompanion.affinity_score} affinity
                        {quotaInfo ? ` · ${quotaInfo.used}/${quotaInfo.limit} msgs today` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setVoiceModalOpen(true)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 px-3 py-2 text-xs font-medium"
                      title="Live Voice Call (Shared Memory)"
                    >
                      <Phone className="h-3.5 w-3.5" /> Call
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab("profile")}
                      className="rounded-xl bg-white/10 hover:bg-white/15 p-2 text-slate-200"
                      title="Companion Profile & Themes"
                    >
                      <Palette className="h-4 w-4" />
                    </button>
                  </div>
                </header>

                <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
                  {loadingChat ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-400" />
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const isUser = msg.role === "user";
                      return (
                        <div
                          key={msg.id}
                          className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
                        >
                          <div
                            className={`max-w-[82%] sm:max-w-[70%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                              isUser
                                ? themeDef.bubbleClass
                                : "bg-white/10 text-slate-100 border border-white/10"
                            }`}
                          >
                            {msg.is_proactive && (
                              <div className="text-[10px] uppercase tracking-wider text-indigo-300 font-semibold mb-1">
                                Proactive AI Check-In
                              </div>
                            )}
                            {msg.modality === "live_call" && (
                              <div className="text-[10px] uppercase tracking-wider text-emerald-300 font-semibold mb-1">
                                From Voice Call
                              </div>
                            )}
                            <div className="whitespace-pre-wrap">
                              {msg.content || (streaming ? "..." : "")}
                            </div>
                          </div>

                          {!isUser && msg.content && !msg.id.startsWith("temp-") && (
                            <div className="flex items-center gap-1.5 mt-1 px-1">
                              <button
                                type="button"
                                onClick={() => speakText(msg.content)}
                                className="text-slate-400 hover:text-indigo-300 p-1"
                                title="Listen"
                              >
                                <Volume2 className="h-3.5 w-3.5" />
                              </button>
                              {(
                                [
                                  ["love", Heart],
                                  ["laugh", Laugh],
                                  ["up", ThumbsUp],
                                  ["down", ThumbsDown],
                                ] as const
                              ).map(([rKey, Icon]) => (
                                <button
                                  key={rKey}
                                  type="button"
                                  onClick={() => handleReaction(msg.id, rKey)}
                                  className={`p-1 rounded transition ${
                                    msg.user_reaction === rKey
                                      ? "text-indigo-400 bg-indigo-500/20"
                                      : "text-slate-500 hover:text-slate-200"
                                  }`}
                                  title={`React: ${rKey}`}
                                >
                                  <Icon className="h-3 w-3" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form
                  onSubmit={handleSendMessage}
                  className="border-t border-white/10 bg-black/40 backdrop-blur-md p-3 flex items-center gap-2"
                >
                  <button
                    type="button"
                    onClick={toggleDictation}
                    className={`rounded-xl p-2.5 transition ${
                      dictating
                        ? "bg-rose-600 text-white animate-pulse"
                        : "bg-white/10 text-slate-300 hover:bg-white/15"
                    }`}
                    title="Voice Dictation"
                  >
                    <Mic className="h-4 w-4" />
                  </button>

                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder={`Message ${activeCompanion.name}...`}
                    disabled={streaming}
                    className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 outline-none focus:border-indigo-500"
                  />

                  <button
                    type="submit"
                    disabled={streaming || !draft.trim()}
                    className="rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 p-2.5 text-white transition"
                  >
                    {streaming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </form>
              </>
            )}
          </section>
        )}

        {/* SCREEN 4: CHARACTER PROFILE, 6-STAGE TRACKER & ROMANTIC CONSENT */}
        {tab === "profile" && activeCompanion && (
          <section className="max-w-3xl w-full mx-auto p-6 space-y-6">
            <div className="rounded-3xl border border-white/10 bg-[#13161F] p-6">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-2xl font-bold text-white">
                  {activeCompanion.name.slice(0, 1)}
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{activeCompanion.name}</h1>
                  <p className="text-xs text-slate-400">
                    Fictional Adult AI ({activeCompanion.age}, {activeCompanion.gender}) · Voice:{" "}
                    {activeCompanion.voice_id}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-300 mt-4">{activeCompanion.backstory}</p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#13161F] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">6-Stage Relationship Progression</h2>
                <span className="text-xs text-indigo-400 font-semibold">
                  {activeCompanion.affinity_score} Affinity Points
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {RELATIONSHIP_STAGES.map((st) => {
                  const unlocked = activeCompanion.relationship_stage >= st.stage;
                  return (
                    <div
                      key={st.stage}
                      className={`rounded-2xl border p-3 ${
                        unlocked
                          ? "border-indigo-500/40 bg-indigo-500/10"
                          : "border-white/5 bg-black/20 opacity-60"
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>
                          {st.stage}. {st.label}
                        </span>
                        {unlocked && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{st.description}</p>
                    </div>
                  );
                })}
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-4 cursor-pointer">
                <div>
                  <div className="text-sm font-medium">
                    Enable Romantic Progression (Stages 5–6 · 18+ Verified Only)
                  </div>
                  <div className="text-xs text-slate-400">
                    {profile.is_age_verified
                      ? "Age verified (18+). You control romantic boundaries per companion."
                      : "Add a verified 18+ birth date in Settings to unlock Stages 5–6."}
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={activeCompanion.romantic_consent_enabled}
                  onChange={(e) =>
                    updateCompanionField({ romantic_consent_enabled: e.target.checked })
                  }
                  className="h-4 w-4"
                />
              </label>
            </div>

            <div className="rounded-3xl border border-white/10 bg-[#13161F] p-6 space-y-3">
              <h2 className="font-semibold">Chat Background Theme & Adaptive Style</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(CHAT_THEMES).map(([key, th]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => updateCompanionField({ chat_theme: key })}
                    className={`rounded-xl px-3 py-2 text-xs font-medium border ${
                      activeCompanion.chat_theme === key
                        ? "border-indigo-500 bg-indigo-600 text-white"
                        : "border-white/10 bg-white/5 text-slate-300"
                    }`}
                  >
                    {th.name}
                  </button>
                ))}
              </div>
              <div className="rounded-2xl bg-black/30 p-3 text-xs text-slate-400">
                <strong className="text-slate-200">Tier 1 Live Style Adaptation:</strong> Reply
                length: <span className="text-indigo-300">{activeCompanion.style_profile?.reply_length ?? "balanced"}</span>{" "}
                · Humor: {Math.round((activeCompanion.style_profile?.humor_level ?? 0.6) * 100)}% ·
                Emoji density:{" "}
                {Math.round((activeCompanion.style_profile?.emoji_density ?? 0.4) * 100)}% · Turns
                calibrated: {activeCompanion.style_profile?.turn_count ?? 0}
              </div>
            </div>
          </section>
        )}

        {/* SCREEN 5: PROACTIVE CHECK-INS / NOTIFICATIONS */}
        {tab === "notifications" && (
          <section className="max-w-3xl w-full mx-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold">Proactive Check-Ins</h1>
                <p className="text-xs text-slate-400">
                  Scheduled via Inngest every 15m respecting timezone quiet hours &amp; saved events.
                </p>
              </div>
              {activeCompanion && (
                <button
                  type="button"
                  disabled={triggeringProactive}
                  onClick={handleTriggerProactive}
                  className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-semibold text-white"
                >
                  {triggeringProactive ? "Generating..." : `Send Test Check-In (${activeCompanion.name})`}
                </button>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-xs text-slate-400">
                No proactive check-ins yet. Companions reach out naturally around saved events and
                active threads.
              </div>
            ) : (
              <div className="space-y-3">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-2xl border border-white/10 bg-[#13161F] p-4 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-semibold text-indigo-300">
                        {n.companions?.name ?? "AI Companion"} · AI-Generated Check-In
                      </div>
                      <p className="text-sm text-slate-200 mt-1">{n.content}</p>
                      <div className="text-[10px] text-slate-500 mt-1">
                        {new Date(n.created_at).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveCompanionId(n.companion_id);
                        setTab("chat");
                      }}
                      className="rounded-lg bg-white/10 px-3 py-1.5 text-xs hover:bg-white/15"
                    >
                      Reply
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* SCREEN 6: SEMANTIC MEMORY MANAGER */}
        {tab === "memories" && (
          <section className="max-w-4xl w-full mx-auto p-6 space-y-6">
            <div>
              <h1 className="text-2xl font-bold">Long-Term Semantic Memories</h1>
              <p className="text-xs text-slate-400">
                Powered by PostgreSQL pgvector (768-dim hybrid retrieval). View, add, or delete any
                memory at any time.
              </p>
            </div>

            <form
              onSubmit={handleAddMemory}
              className="rounded-3xl border border-white/10 bg-[#13161F] p-4 grid gap-3 sm:grid-cols-4"
            >
              <select
                value={newMem.category}
                onChange={(e) =>
                  setNewMem({ ...newMem, category: e.target.value as MemoryCategory })
                }
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs"
              >
                <option value="identity">Identity</option>
                <option value="interest">Interest</option>
                <option value="relationship">Relationship</option>
                <option value="work_study">Work / Study</option>
                <option value="event">Upcoming Event</option>
                <option value="preference">Preference</option>
              </select>
              <input
                required
                placeholder="e.g., Studying CS in Paris; final exam next Friday"
                value={newMem.fact}
                onChange={(e) => setNewMem({ ...newMem, fact: e.target.value })}
                className="sm:col-span-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs"
              />
              <input
                type="date"
                value={newMem.eventDate}
                onChange={(e) => setNewMem({ ...newMem, eventDate: e.target.value })}
                className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs"
              />
              <button
                type="submit"
                className="sm:col-span-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2 text-xs font-semibold text-white"
              >
                Save &amp; Index Memory
              </button>
            </form>

            <div className="space-y-2.5">
              {memories.length === 0 ? (
                <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center text-xs text-slate-400">
                  No saved memories yet. Chat naturally or add a memory above.
                </div>
              ) : (
                memories.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-2xl border border-white/10 bg-[#13161F] p-4 flex items-center justify-between gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-indigo-300">
                          {m.category}
                        </span>
                        {m.event_date && (
                          <span className="text-[11px] text-amber-300">Event: {m.event_date}</span>
                        )}
                      </div>
                      <p className="text-sm text-slate-100 mt-1">{m.fact}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteMemory(m.id)}
                      className="text-slate-500 hover:text-rose-400 p-1.5"
                      title="Delete memory"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>
        )}

        {/* SCREEN 7: SETTINGS, STRIPE BILLING, PRIVACY & GDPR */}
        {tab === "settings" && (
          <section className="max-w-3xl w-full mx-auto p-6 space-y-6">
            <h1 className="text-2xl font-bold">Settings, Subscription &amp; Privacy</h1>

            {/* Real Stripe Subscription Plans */}
            <div className="rounded-3xl border border-white/10 bg-[#13161F] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">Subscription Plan</h2>
                  <p className="text-xs text-slate-400">
                    Current tier:{" "}
                    <strong className="uppercase text-indigo-400">{profile.plan_tier}</strong> (
                    {profile.subscription_status})
                  </p>
                </div>
                <button
                  type="button"
                  disabled={billingLoading === "portal"}
                  onClick={handleStripePortal}
                  className="rounded-xl bg-white/10 hover:bg-white/15 px-3.5 py-2 text-xs font-medium"
                >
                  Manage Billing Portal
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-4">
                  <div className="font-bold">Kindred Plus · €9.99/mo</div>
                  <p className="text-xs text-slate-300 mt-1">
                    500 msgs/day · 5 companions + Custom Studio · 30 min/mo Live Voice · 500
                    semantic memories.
                  </p>
                  <button
                    type="button"
                    disabled={billingLoading === "plus"}
                    onClick={() => handleStripeCheckout("plus")}
                    className="mt-3 w-full rounded-xl bg-indigo-600 hover:bg-indigo-500 py-2 text-xs font-semibold text-white"
                  >
                    {billingLoading === "plus" ? "Redirecting..." : "Upgrade to Plus"}
                  </button>
                </div>

                <div className="rounded-2xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-4">
                  <div className="font-bold">Kindred Pro · €19.99/mo</div>
                  <p className="text-xs text-slate-300 mt-1">
                    5,000 msgs/day · All exclusive archetypes · 180 min/mo Live Voice · Unlimited
                    semantic memory.
                  </p>
                  <button
                    type="button"
                    disabled={billingLoading === "pro"}
                    onClick={() => handleStripeCheckout("pro")}
                    className="mt-3 w-full rounded-xl bg-fuchsia-600 hover:bg-fuchsia-500 py-2 text-xs font-semibold text-white"
                  >
                    {billingLoading === "pro" ? "Redirecting..." : "Upgrade to Pro"}
                  </button>
                </div>
              </div>
            </div>

            {/* Preferences, Quiet Hours, Voice Speed & Age Verification */}
            <div className="rounded-3xl border border-white/10 bg-[#13161F] p-6 space-y-4">
              <h2 className="font-semibold">Personalization &amp; Proactive Quiet Hours</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Display Name</span>
                  <input
                    type="text"
                    value={profile.display_name}
                    onChange={(e) => setProfile({ ...profile, display_name: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Birth Date (18+ gate for romantic stages)</span>
                  <input
                    type="date"
                    value={profile.birth_date ?? ""}
                    onChange={(e) => setProfile({ ...profile, birth_date: e.target.value || null })}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Quiet Hours Start</span>
                  <input
                    type="time"
                    value={profile.quiet_hours_start.slice(0, 5)}
                    onChange={(e) => setProfile({ ...profile, quiet_hours_start: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Quiet Hours End</span>
                  <input
                    type="time"
                    value={profile.quiet_hours_end.slice(0, 5)}
                    onChange={(e) => setProfile({ ...profile, quiet_hours_end: e.target.value })}
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Proactive Frequency</span>
                  <select
                    value={profile.proactive_frequency}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        proactive_frequency: e.target.value as UserProfile["proactive_frequency"],
                      })
                    }
                    className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm"
                  >
                    <option value="off">Off</option>
                    <option value="low">Low (every ~36h)</option>
                    <option value="balanced">Balanced (every ~14h)</option>
                    <option value="high">High (every ~6h)</option>
                  </select>
                </label>
                <label className="text-xs space-y-1">
                  <span className="text-slate-400">Voice Speed ({profile.voice_speed}x)</span>
                  <input
                    type="range"
                    min={0.7}
                    max={1.4}
                    step={0.05}
                    value={profile.voice_speed}
                    onChange={(e) =>
                      setProfile({ ...profile, voice_speed: Number(e.target.value) })
                    }
                    className="w-full mt-2"
                  />
                </label>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-white/10 bg-black/20 p-3.5 text-xs cursor-pointer">
                <span>
                  <strong className="block text-slate-200">
                    Opt-In Anonymized Learning (Tier 2/3 Auto-Upgrade)
                  </strong>
                  Default OFF. When enabled, PII-scrubbed feedback signals help improve companion
                  naturalness globally.
                </span>
                <input
                  type="checkbox"
                  checked={profile.allow_anonymized_training}
                  onChange={(e) =>
                    setProfile({ ...profile, allow_anonymized_training: e.target.checked })
                  }
                />
              </label>

              <button
                type="button"
                disabled={savingSettings}
                onClick={() =>
                  handleSaveSettings({
                    display_name: profile.display_name,
                    birth_date: profile.birth_date,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
                    proactive_frequency: profile.proactive_frequency,
                    proactive_enabled: profile.proactive_frequency !== "off",
                    quiet_hours_start: profile.quiet_hours_start,
                    quiet_hours_end: profile.quiet_hours_end,
                    voice_speed: profile.voice_speed,
                    allow_anonymized_training: profile.allow_anonymized_training,
                  })
                }
                className="rounded-xl bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-xs font-semibold text-white"
              >
                {savingSettings ? "Saving..." : "Save Preferences"}
              </button>
            </div>

            {/* GDPR Export & Permanent Erasure */}
            <div className="rounded-3xl border border-rose-500/20 bg-rose-500/5 p-6 space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                GDPR Privacy Rights &amp; Account Erasure
              </div>
              <a
                href="/api/account/export"
                className="inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-medium"
              >
                <Download className="h-4 w-4" /> Export All Personal Data (JSON)
              </a>

              <div className="pt-2 border-t border-white/10 space-y-2">
                <p className="text-xs text-rose-300">
                  Type <strong>DELETE MY ACCOUNT</strong> to permanently cancel Stripe billing and
                  erase all chats, memories, and profile records.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    placeholder="DELETE MY ACCOUNT"
                    className="flex-1 rounded-xl border border-rose-500/30 bg-black/30 px-3 py-2 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleDeleteAccount}
                    className="rounded-xl bg-rose-600 hover:bg-rose-500 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Delete Account
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-white/10 bg-[#10131C]/95 backdrop-blur-md grid grid-cols-7 px-1 py-1.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`flex flex-col items-center gap-0.5 py-1 text-[10px] ${
                active ? "text-indigo-400 font-semibold" : "text-slate-400"
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="truncate max-w-full">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {voiceModalOpen && activeCompanion && (
        <VoiceCallModal
          companion={activeCompanion}
          voiceSpeed={profile.voice_speed}
          onClose={() => setVoiceModalOpen(false)}
          onSynced={() => loadCompanionChat(activeCompanion.id)}
        />
      )}
    </div>
  );
}
