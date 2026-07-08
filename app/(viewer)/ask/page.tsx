import type { Metadata } from "next";

import { ChatPanel } from "@/components/chat-panel";

export const metadata: Metadata = {
  title: "Asistent — AIM Viewer",
};

/**
 * LLM rozhranie nad grafom (F6, D-056): otázky v prirodzenom jazyku,
 * odpovede s trust-loop citáciami (karta / 3D / výkres).
 */
export default function AskPage() {
  return (
    <div className="mx-auto flex h-[calc(100vh-6rem)] max-w-3xl flex-col">
      <header className="mb-3">
        <span className="inline-block rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          Asistent
        </span>
        <h1 className="mt-2 font-heading text-2xl font-semibold">
          Opýtaj sa grafu budovy
        </h1>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border bg-card">
        <ChatPanel />
      </div>
    </div>
  );
}
