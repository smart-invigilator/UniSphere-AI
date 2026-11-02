export function CardSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-3 flex items-center gap-3">
        <div className="skeleton h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <div className="skeleton h-3 w-2/3 rounded" />
          <div className="skeleton h-2 w-1/3 rounded" />
        </div>
      </div>
      <div className="skeleton mb-2 h-24 w-full rounded-lg" />
      <div className="skeleton h-2 w-full rounded" />
    </div>
  )
}
export function StatSkeleton() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="skeleton mb-3 h-2 w-1/2 rounded" />
      <div className="skeleton h-6 w-1/3 rounded" />
    </div>
  )
}
