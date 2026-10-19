import { Search, SlidersHorizontal, ArrowUpDown } from 'lucide-react'

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'alert', label: 'Alert' },
  { id: 'offline', label: 'Offline' },
  { id: 'risk', label: 'High Risk' },
]
const SORTS = [
  { id: 'alerts-desc', label: 'Most alerts' },
  { id: 'alerts-asc', label: 'Least alerts' },
  { id: 'recent', label: 'Recently active' },
  { id: 'alpha', label: 'Alphabetical' },
]

export default function SearchFilterBar({ query, setQuery, filter, setFilter, sort, setSort, alertCount }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative flex-1 lg:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or ID…"
          className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:bg-slate-800"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
          <SlidersHorizontal className="ml-1.5 mr-0.5 h-3.5 w-3.5 text-slate-400" />
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`relative rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                filter === f.id
                  ? 'bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-300'
                  : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              {f.label}
              {f.id === 'alert' && alertCount > 0 && (
                <span className="ml-1 rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">{alertCount}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative">
          <ArrowUpDown className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="appearance-none rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-7 text-xs font-medium text-slate-700 focus:border-brand-500 focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
