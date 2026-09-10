export function WatermarkChrome({
  required,
  label = "YouFlicks",
}: {
  required: boolean;
  label?: string;
}) {
  if (!required) {
    return null;
  }
  return (
    <div
      data-testid="watermark-chrome"
      className="pointer-events-none absolute right-3 bottom-3 rounded bg-black/55 px-2 py-1 text-[11px] tracking-wide text-white/90"
    >
      {label}
    </div>
  );
}
