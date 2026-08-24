export default async function AppLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-4 w-80 animate-pulse rounded bg-muted" />
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  );
}
