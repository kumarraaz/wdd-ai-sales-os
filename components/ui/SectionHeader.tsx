import { cn } from "@/lib/format";

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  dark?: boolean;
}

export default function SectionHeader({ eyebrow, title, description, align = "center", dark = false }: Props) {
  return (
    <div className={cn("max-w-2xl", align === "center" ? "mx-auto text-center" : "text-left")}>
      {eyebrow && (
        <p
          className={cn(
            "text-xs font-semibold uppercase tracking-[0.14em]",
            dark ? "text-moss-300" : "text-forest-700"
          )}
        >
          {eyebrow}
        </p>
      )}
      <h2
        className={cn(
          "mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl",
          dark ? "text-white" : "text-forest-950"
        )}
      >
        {title}
      </h2>
      {description && (
        <p className={cn("mt-4 text-[15px] leading-relaxed", dark ? "text-forest-200/85" : "text-charcoal-600")}>
          {description}
        </p>
      )}
    </div>
  );
}
