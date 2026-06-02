// Shown instantly on every in-app navigation while the server component loads.
// The shell (sidebar/topbar) stays mounted, so switching sections feels immediate.
export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-3 w-24 rounded bg-zinc-200" />
        <div className="h-6 w-56 rounded bg-zinc-200" />
        <div className="h-3 w-80 rounded bg-zinc-100" />
      </div>
      <div className="mb-3 flex gap-2">
        <div className="h-9 w-72 rounded-md bg-zinc-100" />
      </div>
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
        <div className="h-10 border-b border-zinc-200 bg-zinc-50" />
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3">
            <div className="h-4 w-1/4 rounded bg-zinc-100" />
            <div className="h-4 w-1/5 rounded bg-zinc-100" />
            <div className="h-4 w-1/6 rounded bg-zinc-100" />
            <div className="ml-auto h-4 w-16 rounded bg-zinc-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
