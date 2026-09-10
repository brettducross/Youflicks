import type { EntitlementSummary } from "@/server/entitlement/types";

function formatCap(ms: number) {
  const minutes = Math.round(ms / 60_000);
  return `${minutes}-minute`;
}

export function EntitlementHonesty({ summary }: { summary: EntitlementSummary }) {
  const parts = [
    summary.remainingMovieGenerations === 1
      ? "1 free movie left this hour"
      : `${summary.remainingMovieGenerations} free movies left this hour`,
    `max ${formatCap(summary.maxOutputDurationMs)}`,
    summary.watermarkRequired ? "watermarked" : null,
    summary.adsEnabled ? "ads on" : null,
  ].filter(Boolean);

  return (
    <p data-testid="entitlement-honesty" className="text-xs text-muted-foreground">
      Free plan: {parts.join(" · ")}
    </p>
  );
}
