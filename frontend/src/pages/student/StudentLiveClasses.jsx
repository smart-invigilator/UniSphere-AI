import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '../../services/api'
import { LiveClassCard } from '../../components/live/LiveClassList'

const REFRESH_MS = 30000

export default function StudentLiveClasses() {
  const [classes, setClasses] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let timer = null
    let cancelled = false
    const load = async () => {
      try {
        const data = await api.get('/live-classes/mine')
        if (!cancelled) {
          setClasses(data)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }
    const schedule = () => {
      clearTimeout(timer)
      if (document.visibilityState === 'visible') timer = setTimeout(async () => {
        await load()
        schedule()
      }, REFRESH_MS)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load().then(schedule)
      else clearTimeout(timer)
    }
    load().then(schedule)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const live = (classes || []).filter((c) => c.status === 'live')
  const upcoming = (classes || []).filter((c) => c.status === 'scheduled')
  const past = (classes || []).filter((c) => c.status === 'ended')

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Live Classes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">Classes from the courses you're enrolled in.</p>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-500/10" role="alert">{error}</p>}
      {classes === null ? <Loader2 className="h-5 w-5 animate-spin text-slate-400" /> : (
        <>
          {[['Live now', live], ['Upcoming', upcoming], ['Recently ended', past]].map(([title, list]) => list.length > 0 && (
            <section key={title} className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h2>
              {list.map((lc) => <LiveClassCard key={lc.id} lc={lc} isTeacher={false} />)}
            </section>
          ))}
          {!classes.length && <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400 dark:border-slate-700">No live classes scheduled for your courses.</p>}
        </>
      )}
    </main>
  )
}