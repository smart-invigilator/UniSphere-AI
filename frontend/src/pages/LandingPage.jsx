import { Link } from 'react-router-dom'
import {
  Shield, ScanFace, MonitorSmartphone, Mic, Eye, Users, ClipboardCheck, Radar,
  ArrowRight, PlayCircle, GraduationCap, LayoutDashboard, CheckCircle2, KeyRound,
} from 'lucide-react'

const FEATURES = [
  { icon: ScanFace, title: 'AI-Powered Proctoring', desc: 'Continuous, automated monitoring throughout every session — no manual watch-standing required.' },
  { icon: KeyRound, title: 'Continuous Identity Verification', desc: 'Confirms the registered candidate stays behind the camera for the full exam duration.' },
  { icon: Eye, title: 'Face & Object Detection', desc: 'Flags multiple faces, absent faces, and unauthorized objects like phones or notes.' },
  { icon: MonitorSmartphone, title: 'Screen Monitoring', desc: 'Tracks tab switches and screen-share status to keep candidates inside the exam environment.' },
  { icon: Mic, title: 'Audio Monitoring', desc: 'Listens for unusual audio patterns that may indicate outside assistance.' },
  { icon: LayoutDashboard, title: 'Live Examiner Dashboard', desc: 'Gives examiners a real-time grid of every candidate, sorted by risk.' },
  { icon: Radar, title: 'Automated Violation Detection', desc: 'Every anomaly is logged to a timeline with severity and timestamp automatically.' },
  { icon: Shield, title: 'Secure Exam Environment', desc: 'Locks down the session with layered checks before a single question is shown.' },
]

const STEPS = [
  { label: 'Join Exam', desc: 'Enter your exam code or select a scheduled exam from your dashboard.' },
  { label: 'Complete Security Checks', desc: 'Camera, microphone, screen share, identity, and liveness — verified step by step.' },
  { label: 'Start Secure Exam', desc: 'Answer questions in a focused, distraction-free interface with a live timer.' },
  { label: 'AI and Examiner Monitor the Session', desc: 'Your session is watched by AI models and, when needed, a live examiner.' },
]

export default function LandingPage() {
  return (
    <div className="bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      {/* Nav */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
              <Shield className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
            </span>
            <span className="text-base font-bold">UniSphere AI</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-600 dark:text-slate-300 md:flex">
            <a href="#features" className="hover:text-slate-900 dark:hover:text-white">Features</a>
            <a href="#how-it-works" className="hover:text-slate-900 dark:hover:text-white">How it works</a>
            <a href="#roles" className="hover:text-slate-900 dark:hover:text-white">Roles</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to="/login" className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Log in
            </Link>
            <Link to="/register" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-slate-200 dark:border-slate-800">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(59,130,246,0.10),transparent)]" />
        <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-400">
              <Radar className="h-3.5 w-3.5" /> AI-Powered Examination Platform
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
              Secure online exams,<br /> powered by intelligent proctoring
            </h1>
            <p className="mt-4 max-w-lg text-base text-slate-500 dark:text-slate-400">
              Give every candidate a fair, focused exam environment — while your team gets a real-time view
              of identity, attention, and integrity across the whole cohort.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link to="/register" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700">
                Get Started <ArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/login" className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                <PlayCircle className="h-4 w-4" /> View Demo
              </Link>
            </div>
            <div className="mt-8 flex items-center gap-6 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> No backend required to try</span>
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> Student & teacher demo modes</span>
            </div>
          </div>

          <div className="relative">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-600">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Secure Session Active
                </span>
                <span className="font-mono text-xs text-slate-400">01:24:35</span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {['Camera', 'Screen', 'Identity'].map((label) => (
                  <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 p-2.5 text-center dark:border-slate-800 dark:bg-slate-800/60">
                    <ScanFace className="mx-auto h-4 w-4 text-brand-600" />
                    <p className="mt-1 text-[10px] font-medium text-slate-500">{label}</p>
                    <p className="text-[10px] font-bold text-emerald-600">Verified</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {['Aisha Khan', 'Bilal Ahmed', 'Chen Li'].map((n, i) => (
                  <div key={n} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs dark:border-slate-800">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{n}</span>
                    <span className={`font-semibold ${i === 2 ? 'text-amber-600' : 'text-emerald-600'}`}>{i === 2 ? 'Warning' : 'Normal'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Everything integrity monitoring needs</h2>
        <p className="mx-auto mt-2 max-w-xl text-center text-sm text-slate-500 dark:text-slate-400">
          Every layer works together — from the moment a candidate joins to the final violation report.
        </p>
        <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-3 text-sm font-semibold">{f.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-y border-slate-200 bg-slate-50 py-16 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h2 className="text-center text-2xl font-bold sm:text-3xl">How it works</h2>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.label} className="relative rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 text-sm font-semibold">{s.label}</h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-bold sm:text-3xl">Built for both sides of the exam</h2>
        <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
              <GraduationCap className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-lg font-bold">Student</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Join scheduled exams</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Complete system checks</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Take secure exams</li>
            </ul>
            <Link to="/register" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
              Continue as Student <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400">
              <ClipboardCheck className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-lg font-bold">Teacher / Examiner</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-500 dark:text-slate-400">
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Create and publish exams</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Monitor candidates live</li>
              <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Review violations and activity</li>
            </ul>
            <Link to="/register" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">
              Continue as Teacher <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-400 dark:border-slate-800">
        <div className="flex items-center justify-center gap-1.5">
          <Users className="h-3.5 w-3.5" /> Frontend prototype — no real data leaves your browser.
        </div>
      </footer>
    </div>
  )
}
