"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ShieldCheck, Loader2, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { EU_AI_ACT_DISCLOSURE } from "@/lib/ai/safety";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [acceptedDisclosure, setAcceptedDisclosure] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (mode === "signup" && !acceptedDisclosure) {
      setError("Please acknowledge the AI transparency disclosure to continue.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      if (mode === "signin") {
        const { error: signInErr } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInErr) throw signInErr;
        router.push("/");
        router.refresh();
      } else {
        const { data, error: signUpErr } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
            data: {
              display_name: displayName.trim() || email.split("@")[0],
              birth_date: birthDate || null,
            },
          },
        });
        if (signUpErr) throw signUpErr;
        if (data.session) {
          router.push("/");
          router.refresh();
        } else {
          setInfo("Check your email inbox to confirm your account, then sign in.");
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#0B0D12] text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#13161F] p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-6">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center shadow-lg">
            <Heart className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Kindred</h1>
            <p className="text-xs text-slate-400">Meaningful AI companionship, privately yours</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 mb-6">
          <button
            type="button"
            onClick={() => setMode("signin")}
            className={`rounded-lg py-2 text-sm font-medium transition ${
              mode === "signin" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => setMode("signup")}
            className={`rounded-lg py-2 text-sm font-medium transition ${
              mode === "signup" ? "bg-indigo-600 text-white" : "text-slate-400 hover:text-white"
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                What should companions call you?
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your name or nickname"
                required
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              minLength={8}
              required
              className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
            />
          </div>

          {mode === "signup" && (
            <>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Birth Date (optional — required for 18+ romantic stages)
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-2.5 text-sm outline-none focus:border-indigo-500"
                />
              </div>

              <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acceptedDisclosure}
                  onChange={(e) => setAcceptedDisclosure(e.target.checked)}
                  className="mt-0.5 rounded border-white/20"
                />
                <span>{EU_AI_ACT_DISCLOSURE}</span>
              </label>
            </>
          )}

          {error && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
              {error}
            </div>
          )}

          {info && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 py-2.5 text-xs text-emerald-300">
              {info}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {mode === "signin" ? "Sign In to Kindred" : "Create Private Account"}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-2 text-[11px] text-slate-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>Row-level isolated storage, GDPR export/erasure, and opt-in only learning.</span>
        </div>
      </div>
    </main>
  );
}
