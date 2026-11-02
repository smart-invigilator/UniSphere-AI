import { useMemo } from 'react'

export function useFilteredStudents(students, { query, filter, sort }) {
  return useMemo(() => {
    let list = [...students]

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))
    }

    switch (filter) {
      case 'active': list = list.filter((s) => s.connected); break
      case 'alert': list = list.filter((s) => s.status === 'alert'); break
      case 'offline': list = list.filter((s) => !s.connected); break
      case 'risk': list = list.filter((s) => s.attention < 60 || s.alertCount >= 3); break
      default: break
    }

    switch (sort) {
      case 'alerts-desc': list.sort((a, b) => b.alertCount - a.alertCount); break
      case 'alerts-asc': list.sort((a, b) => a.alertCount - b.alertCount); break
      case 'recent': list.sort((a, b) => b.lastActivity - a.lastActivity); break
      case 'alpha': list.sort((a, b) => a.name.localeCompare(b.name)); break
      default: break
    }

    // Always float active alerts to the top
    list.sort((a, b) => (b.status === 'alert' ? 1 : 0) - (a.status === 'alert' ? 1 : 0))
    return list
  }, [students, query, filter, sort])
}
