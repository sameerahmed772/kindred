export interface StreamChatCallbacks {
  onMeta?: (meta: { userMessageId: string; usedToday: number; dailyLimit: number }) => void;
  onDelta: (chunk: string) => void;
  onDone?: (done: {
    assistantMessageId: string | null;
    affinityScore: number;
    relationshipStage: number;
    crisisIntervention?: boolean;
  }) => void;
  onError: (error: { message: string; code?: string; status?: number }) => void;
}

export async function streamCompanionChat(
  params: {
    companionId: string;
    content: string;
    modality?: "text" | "voice_note";
    signal?: AbortSignal;
  },
  callbacks: StreamChatCallbacks
) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companionId: params.companionId,
      content: params.content,
      modality: params.modality ?? "text",
    }),
    signal: params.signal,
  });

  if (!response.ok || !response.body) {
    const errBody = await response.json().catch(() => ({}));
    callbacks.onError({
      message: errBody.error ?? "Failed to send message.",
      code: errBody.code,
      status: response.status,
    });
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;

      const event = JSON.parse(dataLine.slice(6));
      if (event.type === "meta") callbacks.onMeta?.(event);
      if (event.type === "delta") callbacks.onDelta(event.text);
      if (event.type === "done") callbacks.onDone?.(event);
      if (event.type === "error") callbacks.onError({ message: event.message });
    }
  }
}
