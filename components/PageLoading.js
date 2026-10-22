export default function PageLoading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded-lg bg-line" />
      <div className="h-32 animate-pulse rounded-xl bg-line/60" />
    </div>
  );
}
