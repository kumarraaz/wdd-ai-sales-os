"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { DEMO_ACTION_DISABLED_MESSAGE } from "@/lib/demo";
import { leadDisplayName } from "@/lib/lead-display";
import { Skeleton } from "@/components/ui/Skeleton";

/**
 * Every lead status is a column, so no lead is ever hidden or shown under the wrong stage
 * (the board used to fold VERIFIED / FOLLOW_UP / CONVERTED / NOT_RELEVANT into "NEW" and drop NURTURE).
 */
const STAGES = [
  "NEW", "RESEARCHING", "VERIFIED", "QUALIFIED", "CONTACTED", "FOLLOW_UP", "REPLIED",
  "MEETING", "PROPOSAL", "NEGOTIATION", "WON", "CONVERTED", "LOST", "NURTURE", "NOT_RELEVANT",
] as const;

const stageLabel = (s: string) => s.replace(/_/g, " ");

/** The leads API caps a page at 100; the board says so when the workspace has more. */
const BOARD_PAGE_SIZE = 100;

interface Card {
  id: string;
  fullName: string | null;
  phone: string | null;
  website: string | null;
  websiteStatus: string | null;
  opportunityType: string | null;
  leadScore: number;
  company: { name: string } | null;
}

/** Display name: company/business name first, then contact name — never "Unnamed lead". */
function cardTitle(card: Card): string {
  return leadDisplayName(card);
}

/** Keeps the nested stage menu from starting a drag. */
const stopDrag = {
  onMouseDown: (e: React.SyntheticEvent) => e.stopPropagation(),
  onTouchStart: (e: React.SyntheticEvent) => e.stopPropagation(),
  onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation(),
};

function DraggableCard({
  card,
  stage,
  canWrite,
  onMove,
}: {
  card: Card;
  stage: string;
  canWrite: boolean;
  onMove: (cardId: string, toStage: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };
  const opportunityTone =
    card.opportunityType === "HIGH"
      ? "bg-neon-cyan/15 text-neon-cyan"
      : card.opportunityType === "MEDIUM"
        ? "bg-amber-400/15 text-amber-300"
        : "bg-tint/10 text-ink-muted";
  const title = cardTitle(card);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      // The card contains links and a menu, so it must not claim the "button" role dnd-kit adds by default.
      role="group"
      aria-label={title}
      className={`rounded-xl border border-line bg-surface-2 p-3 shadow transition hover:border-neon-cyan/40 ${
        canWrite ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <Link
        href={`/leads/${card.id}`}
        {...stopDrag}
        className="block text-sm font-semibold text-ink hover:text-neon-cyan hover:underline"
      >
        {title}
      </Link>
      <p className="truncate text-xs text-ink-muted">{card.phone ?? "—"}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            card.websiteStatus === "NO_WEBSITE"
              ? "bg-neon-cyan/15 text-neon-cyan"
              : "bg-tint/10 text-ink-dim"
          }`}
        >
          {card.websiteStatus === "NO_WEBSITE" ? "NO WEBSITE" : card.website ? "HAS WEBSITE" : "—"}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${opportunityTone}`}>
          {card.opportunityType ?? "—"}
        </span>
        <span
          className={`text-sm font-semibold ${
            card.leadScore >= 70
              ? "text-neon-lime"
              : card.leadScore >= 40
                ? "text-amber-400"
                : "text-ink-muted"
          }`}
        >
          {card.leadScore}
        </span>
      </div>
      {canWrite && (
        // The reliable way to move a card on phones and with a keyboard; dragging is the shortcut.
        <label className="mt-2 block">
          <span className="sr-only">Move {title} to stage</span>
          <select
            value={stage}
            onChange={(e) => onMove(card.id, e.target.value)}
            {...stopDrag}
            className="min-h-9 w-full rounded-md border border-line bg-black/30 px-2 text-[11px] text-ink-muted outline-none focus:border-neon-cyan"
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                Move to: {stageLabel(s)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function Column({
  stage,
  cards,
  canWrite,
  onMove,
}: {
  stage: string;
  cards: Card[];
  canWrite: boolean;
  onMove: (cardId: string, toStage: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${stageLabel(stage)}, ${cards.length} leads`}
      className={`flex max-h-[calc(100dvh-18.5rem)] min-h-[14rem] w-64 shrink-0 flex-col rounded-card border p-3 transition ${
        isOver ? "border-neon-cyan/60 bg-neon-cyan/5" : "border-line bg-tint/[0.04]"
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-muted">{stageLabel(stage)}</h2>
        <span className="rounded-full bg-tint/10 px-2 py-0.5 text-xs text-ink-muted">{cards.length}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto">
        {cards.map((c) => (
          <DraggableCard key={c.id} card={c} stage={stage} canWrite={canWrite} onMove={onMove} />
        ))}
        {cards.length === 0 && (
          <p className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-ink-dim">
            {canWrite ? "Drop leads here" : "No leads"}
          </p>
        )}
      </div>
    </section>
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
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState("");
  // Mouse drags after 6px; touch drags after a short press, so swiping the board still scrolls it.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  useEffect(() => {
    (async () => {
      try {
        const params = new URLSearchParams({
          pageSize: String(BOARD_PAGE_SIZE),
          sort: "leadScore",
          order: "desc",
          ...(sourceType ? { sourceType } : {}),
        });
        const res = await fetch(`${apiBase}/leads?${params}`, {
          headers: { "x-org-id": orgId },
        });
        if (!res.ok) throw new Error("Failed to load pipeline.");
        const data = await res.json();
        const grouped: Record<string, Card[]> = {};
        for (const s of STAGES) grouped[s] = [];
        for (const l of data.leads as (Card & { status: string })[]) {
          // Unknown statuses cannot be placed honestly, so they are not shown under another stage.
          if (grouped[l.status]) grouped[l.status].push(l);
        }
        setCards(grouped);
        setTotal(typeof data.total === "number" ? data.total : (data.leads as unknown[]).length);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load pipeline.");
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, apiBase, sourceType]);

  const moveCard = useCallback(
    async (cardId: string, toStage: string) => {
      if (!canWrite || !(STAGES as readonly string[]).includes(toStage)) return;
      // Demo mode: cards are inspect-only. Block the move up front with a clear
      // message instead of attempting a write that would be rejected.
      if (demo) {
        setError(`${DEMO_ACTION_DISABLED_MESSAGE} — card moves are not saved in demo mode.`);
        return;
      }

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

      setError(null);
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
    },
    [apiBase, canWrite, cards, demo, orgId],
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;
    void moveCard(String(active.id), String(over.id));
  }

  if (loading)
    return (
      <div role="status" aria-busy="true" className="flex gap-3 overflow-hidden">
        <span className="sr-only">Loading pipeline…</span>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="w-64 shrink-0 rounded-card border border-line p-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-20 w-full" />
            <Skeleton className="mt-2 h-20 w-full" />
            <Skeleton className="mt-2 h-20 w-full" />
          </div>
        ))}
      </div>
    );
  if (error && Object.keys(cards).length === 0)
    return <p role="alert" className="py-10 text-center text-red-300">{error}</p>;

  const shown = Object.values(cards).reduce((n, list) => n + list.length, 0);

  return (
    <div className="min-w-0">
      {error && (
        <p role="alert" className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {!canWrite && (
        <p className="mb-3 text-sm text-ink-muted">You have view-only access — cards cannot be moved.</p>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <label htmlFor="kanban-source" className="text-xs text-ink-muted">
            Source
          </label>
          <select
            id="kanban-source"
            value={sourceType}
            onChange={(e) => {
              setLoading(true);
              setSourceType(e.target.value);
            }}
            className="min-h-10 rounded-control border border-line bg-black/30 px-3 text-sm text-ink outline-none focus:border-neon-cyan"
          >
            <option value="">All sources</option>
            <option value="INSTAGRAM">Instagram</option>
            <option value="GOOGLE_BUSINESS">Google Maps</option>
            <option value="WEB_SEARCH">Google Search</option>
            <option value="CSV">CSV</option>
            <option value="MANUAL">Manual</option>
          </select>
        </div>
        <p className="text-xs text-ink-muted" role="status">
          {total > shown
            ? `Showing the ${shown.toLocaleString("en-IN")} highest-scoring of ${total.toLocaleString("en-IN")} leads. Use Leads to browse the rest.`
            : `${shown.toLocaleString("en-IN")} ${shown === 1 ? "lead" : "leads"}`}
          {canWrite && " · Drag a card, or use its “Move to” menu."}
        </p>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {/* Board scrolls horizontally inside its own viewport; columns keep
            a usable minimum width and the page itself never overflows.
            `relative` keeps the cards' visually hidden labels inside this scroller. */}
        <div className="relative -mx-1 flex gap-3 overflow-x-auto px-1 pb-4">
          {STAGES.map((s) => (
            <Column key={s} stage={s} cards={cards[s] ?? []} canWrite={canWrite} onMove={moveCard} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
