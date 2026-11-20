"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, PhoneOff, Volume2, Loader2, Sparkles } from "lucide-react";
import type { Companion } from "@/lib/types";

interface VoiceTurn {
  role: "user" | "assistant";
  content: string;
}

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

export function VoiceCallModal({
  companion,
  voiceSpeed,
  onClose,
  onSynced,
}: {
  companion: Companion;
  voiceSpeed: number;
  onClose: () => void;
  onSynced: () => void;
}) {
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [speaking, setSpeaking] = useState(false);

  const sessionIdRef = useRef<string | undefined>(undefined);
  const startedAtRef = useRef<number>(Date.now());
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const turnsRef = useRef<VoiceTurn[]>([]);
  turnsRef.current = turns;

  useEffect(() => {
    let active = true;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);

    async function bootstrap() {
      try {
        const res = await fetch("/api/voice/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companionId: companion.id }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Unable to start voice session.");
        }
        if (!active) return;
        sessionIdRef.current = data.sessionId;
        startedAtRef.current = Date.now();
        setStatus("live");
        startSpeechCapture();
      } catch (err: unknown) {
        if (!active) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Voice connection failed.");
      }
    }

    bootstrap();
    return () => {
      active = false;
      clearInterval(timer);
      recognitionRef.current?.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companion.id]);

  function startSpeechCapture() {
    if (typeof window === "undefined") return;
    const SpeechRec =
      (window as unknown as Record<string, new () => SpeechRecognitionInstance>).SpeechRecognition ||
      (window as unknown as Record<string, new () => SpeechRecognitionInstance>).webkitSpeechRecognition;

    if (!SpeechRec) return;
    const recognition = new SpeechRec();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";
    recognition.onresult = async (event) => {
      if (muted) return;
      const last = event.results[event.results.length - 1];
      if (!last?.isFinal) return;
      const spoken = last[0]?.transcript?.trim();
      if (!spoken) return;

      setTurns((prev) => [...prev, { role: "user", content: spoken }]);
      await sendVoiceTurn(spoken);
    };
    recognition.onerror = () => {};
    try {
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // Microphone permission may need user click
    }
  }

  async function sendVoiceTurn(spokenText: string) {
    setSpeaking(true);
    let reply = "";
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companionId: companion.id,
          content: spokenText,
          modality: "voice_note",
        }),
      });
      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("

");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const line = frame.split("
").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "delta") reply += ev.text;
        }
      }

      if (reply.trim()) {
        setTurns((prev) => [...prev, { role: "assistant", content: reply.trim() }]);
        if (typeof window !== "undefined" && "speechSynthesis" in window) {
          const utter = new SpeechSynthesisUtterance(reply.trim());
          utter.rate = voiceSpeed;
          utter.onend = () => setSpeaking(false);
          window.speechSynthesis.speak(utter);
          return;
        }
      }
    } finally {
      setSpeaking(false);
    }
  }

  async function handleHangUp() {
    recognitionRef.current?.stop();
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
    await fetch("/api/voice/transcript", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: sessionIdRef.current,
        companionId: companion.id,
        durationSeconds,
        turns: turnsRef.current,
      }),
    }).catch(() => null);

    onSynced();
    onClose();
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#121520] p-6 text-center shadow-2xl">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-500/15 px-3 py-1 text-[11px] font-medium text-indigo-300 mb-4">
          <Sparkles className="h-3.5 w-3.5" />
          AI Live Voice · Shared Memory Active
        </div>

        <div className="mx-auto mb-4 h-24 w-24 rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 flex items-center justify-center text-3xl font-bold text-white shadow-xl ring-4 ring-indigo-500/20">
          {companion.name.slice(0, 1)}
        </div>

        <h3 className="text-xl font-bold text-white">{companion.name}</h3>
        <p className="text-xs text-slate-400 mt-1">
          {status === "connecting" && "Minting encrypted ephemeral voice token..."}
          {status === "live" && (speaking ? `Speaking · ${mm}:${ss}` : `Listening · ${mm}:${ss}`)}
          {status === "error" && "Call unavailable"}
        </p>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
            {errorMsg}
          </div>
        )}

        <div className="mt-5 max-h-40 overflow-y-auto rounded-2xl bg-black/30 p-3 text-left space-y-2 border border-white/5">
          {turns.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-4">
              {status === "connecting" ? (
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
              ) : (
                "Speak naturally — your call transcript syncs straight into chat memory."
              )}
            </p>
          ) : (
            turns.map((t, i) => (
              <div key={i} className="text-xs">
                <span className="font-semibold text-indigo-300">
                  {t.role === "user" ? "You: " : `${companion.name}: `}
                </span>
                <span className="text-slate-200">{t.content}</span>
              </div>
            ))
          )}
        </div>

        <div className="mt-6 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => setMuted((m) => !m)}
            className={`h-12 w-12 rounded-full flex items-center justify-center transition ${
              muted ? "bg-amber-500/20 text-amber-300" : "bg-white/10 text-white hover:bg-white/15"
            }`}
            title={muted ? "Unmute" : "Mute"}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          <button
            type="button"
            onClick={handleHangUp}
            className="h-14 w-14 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg transition"
            title="End Call & Sync Memory"
          >
            <PhoneOff className="h-6 w-6" />
          </button>

          <div className="h-12 w-12 rounded-full bg-white/5 text-indigo-300 flex items-center justify-center">
            <Volume2 className={`h-5 w-5 ${speaking ? "animate-pulse" : ""}`} />
          </div>
        </div>
      </div>
    </div>
  );
}
