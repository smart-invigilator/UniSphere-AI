const COLORS = ['bg-blue-500','bg-violet-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500','bg-indigo-500','bg-teal-500']
function pick(seed) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h << 5) - h + seed.charCodeAt(i)
  return COLORS[Math.abs(h) % COLORS.length]
}
export default function Avatar({ name, size = 'md' }) {
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const sz = { sm: 'h-7 w-7 text-[11px]', md: 'h-9 w-9 text-xs', lg: 'h-12 w-12 text-sm' }
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${pick(name)} ${sz[size]}`}>
      {initials}
    </span>
  )
}
