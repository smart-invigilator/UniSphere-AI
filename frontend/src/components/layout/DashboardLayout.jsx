import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu } from 'lucide-react'
import Sidebar from './Sidebar'
import AppNavbar from './AppNavbar'

export default function DashboardLayout({ items }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <AppNavbar
        leading={
          <button
            onClick={() => setOpen((o) => !o)}
            className="mr-1 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 lg:hidden"
            aria-label="Toggle menu"
          >
            <Menu className="h-5 w-5" />
          </button>
        }
      />
      <div className="mx-auto flex max-w-[1600px]">
        <Sidebar items={items} open={open} onClose={() => setOpen(false)} />
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
