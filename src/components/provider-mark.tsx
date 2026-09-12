import { cn } from "@/lib/utils";
import type { ProviderId } from "@/shared/usage";

const marks: Record<ProviderId, { label: string; className: string }> = {
  codex: { label: "Codex", className: "bg-foreground text-background" },
  cursor: {
    label: "Cursor",
    className: "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-black",
  },
  grok: {
    label: "Grok",
    className: "bg-neutral-700 text-white dark:bg-neutral-300 dark:text-black",
  },
  zenmux: { label: "ZenMux Subscription", className: "bg-neutral-500 text-white" },
  kimi: {
    label: "Kimi",
    className: "bg-neutral-300 text-neutral-950 dark:bg-neutral-600 dark:text-white",
  },
};

export function ProviderMark({
  provider,
  className,
}: {
  provider: ProviderId;
  className?: string;
}) {
  const mark = marks[provider];
  return (
    <span
      className={cn(
        "inline-flex h-7 w-fit shrink-0 items-center whitespace-nowrap px-2.5 text-[10px] font-semibold tracking-tight",
        mark.className,
        className,
      )}
    >
      {mark.label}
    </span>
  );
}
