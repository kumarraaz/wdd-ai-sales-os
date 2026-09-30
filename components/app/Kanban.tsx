"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";

const STAGES = [
  "NEW", "RESEARCHING", "QUALIFIED", "CONTACTED", "REPLIED",
  "MEETING", "PROPOSAL", "NEGOTIATION", "WON", "LOST",
] as const;

interface Card {
  id: string;
  fullName: string | null;
  email: string | null;
  leadScore: number;
  company: { name: string } | null;
}

function DraggableCard({ card }: { card: Card }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab rounded-xl border border-white/10 bg-[#16283f] p-3 shadow transition hover:border-[#D4AF37]/40 active:cursor-grabbing"
    >
      <p className="text-sm font-semibold">{card.fullName || "Unnamed lead"}</p>
      <p className="truncate text-xs text-white/50">
        {card.company?.name ?? card.email ?? "—"}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-white/40">Score</span>
        <span className={`text-sm font-bold ${card.leadScore >= 70 ? "text-emerald-400" : card.leadScore >= 40 ? "text-amber-400" : "text-white/50"}`}>
          {card.leadScore}
        </span>
      </div>
    </div>
  );
}

function Column({ stage, cards }: { stage: string; cards: Card[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <div
      ref={setNodeRef}
      className={`flex w-64 shrink-0 flex-col rounded-2xl border p-3 transition ${
        isOver ? "border-[#D4AF37]/60 bg-[#D4AF37]/5" : "border-white/10 bg-white/[0.03]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-white/70">{stage}</h3>
        <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/60">{cards.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} />
        ))}
        {cards.length === 0 && (
          <p className="rounded-lg border border-dashed border-white/10 p-3 text-center text-xs text-white/30">
            Drop leads here
          </p>
        )}
      </div>
    </div>
  );
}

export function Kanban({
  orgId,
  canWrite,
  apiBase = "/api",
  demo = false,
}: {
  orgId: string;
  canWrite: boolean;
  /** Demo mode passes "/api/demo" so reads hit the fixture API. */
  apiBase?: string;
  /** Demo mode: card moves are blocked with "Demo Mode — Action Disabled". */
  demo?: boolean;
}) {
  const [cards, setCards] = useState<Record<string, Card[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/leads?pageSize=100&sort=leadScore&order=desc`, {
          headers: { "x-org-id": orgId },
        });
        if (!res.ok) throw new Error("Failed to load pipeline.");
        const data = await res.json();
        const grouped: Record<string, Card[]> = {};
        for (const s of STAGES) grouped[s] = [];
        grouped["NURTURE"] = [];
        for (const l of data.leads as (Card & { status: string })[]) {
          const key = grouped[l.status] ? l.status : "NEW";
          grouped[key].push(l);
        }
        setCards(grouped);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load pipeline.");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, apiBase]);

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || !canWrite) return;
    // Demo mode: cards are inspect-only. Block the move up front with a clear
    // message instead of attempting a write that would be rejected.
    if (demo) {
      setError(`${DEMO_ACTION_DISABLED_MESSAGE} — card moves are not saved in demo mode.`);
      return;
    }
    const toStage = String(over.id);
    const cardId = String(active.id);

    // Find source stage + card, optimistically move.
    let fromStage = "";
    let card: Card | undefined;
    for (const [stage, list] of Object.entries(cards)) {
      const found = list.find((c) => c.id === cardId);
      if (found) {
        fromStage = stage;
        card = found;
        break;
      }
    }
    if (!card || fromStage === toStage) return;

    setCards((prev) => ({
      ...prev,
      [fromStage]: prev[fromStage].filter((c) => c.id !== cardId),
      [toStage]: [card!, ...prev[toStage]],
    }));

    try {
      const res = await fetch(`${apiBase}/leads/${cardId}`, {
        method: "PATCH",
        headers: { "x-org-id": orgId, "Content-Type": "application/json" },
        body: JSON.stringify({ status: toStage }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Roll back on failure.
      setCards((prev) => ({
        ...prev,
        [toStage]: prev[toStage].filter((c) => c.id !== cardId),
        [fromStage]: [card!, ...prev[fromStage]],
      }));
      setError("Could not move the card. Please try again.");
    }
  }

  if (loading) return <p className="py-10 text-center text-white/40">Loading pipeline…</p>;
  if (error && Object.keys(cards).length === 0)
    return <p role="alert" className="py-10 text-center text-red-400">{error}</p>;

  return (
    <div className="min-w-0">
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}
      {!canWrite && (
        <p className="mb-3 text-sm text-white/40">You have view-only access — cards cannot be moved.</p>
      )}
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {/* Board scrolls horizontally inside its own viewport; columns keep
            a usable minimum width and the page itself never overflows. */}
        <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
          {STAGES.map((s) => (
            <Column key={s} stage={s} cards={cards[s] ?? []} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
