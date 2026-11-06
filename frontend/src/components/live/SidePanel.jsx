import { useEffect, useMemo, useRef, useState } from 'react'
import { Track } from 'livekit-client'
import {
  X, Send, Mic, MicOff, Video, VideoOff, MonitorUp, Hand, Star, UserMinus, Lock, Unlock, MessageSquareOff,
  MessageSquare, CheckCircle2, EyeOff, HelpCircle, VolumeX,
} from 'lucide-react'
import { api } from '../../services/api'
import { participantRole, userIdOf, canPublish, ROLE_TEACHER } from './liveUtils'

function timeOf(iso) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function MessageList({ items, isTeacher, classId, emptyText, question = false }) {
  const endRef = useRef(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])
  const act = (id, action) => api.post(`/live-classes/${classId}/messages/${id}/${action}`).catch(() => {})
  if (!items.length) return <p className="px-3 py-6 text-center text-xs text-slate-400">{emptyText}</p>
  return (
    <ul className="space-y-2 px-3 py-2">
      {items.map((m) => (
        <li key={m.id} className={`rounded-lg px-2.5 py-1.5 text-sm ${m.hidden ? 'bg-rose-50 opacity-70 dark:bg-rose-500/10' : 'bg-slate-50 dark:bg-slate-800'}`} data-testid={question ? 'question-item' : 'chat-item'}>
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-xs font-semibold ${m.role === ROLE_TEACHER ? 'text-brand-600' : 'text-slate-700 dark:text-slate-200'}`}>
              {m.name}{m.role === ROLE_TEACHER ? ' · Teacher' : ''}
            </span>
            <span className="shrink-0 text-[10px] text-slate-400">{timeOf(m.created_at)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-slate-800 dark:text-slate-100">{m.text}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
            {question && m.answered && <span className="flex items-center gap-1 font-semibold text-emerald-600"><CheckCircle2 className="h-3 w-3" /> Answered</span>}
            {m.hidden && <span className="font-semibold text-rose-600">Hidden from students</span>}
            {isTeacher && question && !m.answered && (
              <button type="button" onClick={() => act(m.id, 'answer')} className="font-semibold text-emerald-700 hover:underline">Mark answered</button>
            )}
            {isTeacher && !m.hidden && (
              <button type="button" onClick={() => act(m.id, 'hide')} className="flex items-center gap-0.5 font-semibold text-slate-500 hover:text-rose-600"><EyeOff className="h-3 w-3" /> Hide</button>
            )}
          </div>
        </li>
      ))}
      <li ref={endRef} />
    </ul>
  )
}

function Composer({ classId, kind, disabled, placeholder, onError }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const send = async (e) => {
    e.preventDefault()
    const value = text.trim()
    if (!value || sending) return
    setSending(true)
    try {
      await api.post(`/live-classes/${classId}/messages`, { kind, text: value })
      setText('')
    } catch (err) {
      onError(err.message)
    } finally {
      setSending(false)
    }
  }
  return (
    <form onSubmit={send} className="flex gap-2 border-t border-slate-200 p-2 dark:border-slate-700">
      <input
        value={text}
        disabled={disabled}
        maxLength={1000}
        onChange={(e) => setText(e.target.value)}
        placeholder={disabled ? 'Turned off by the teacher' : placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
      <button type="submit" disabled={disabled || sending || !text.trim()} aria-label="Send" className="rounded-lg bg-brand-600 px-3 text-white hover:bg-brand-700 disabled:opacity-40">
        <Send className="h-4 w-4" />
      </button>
    </form>
  )
}

function Toggle({ on, onClick, iconOn: IconOn, iconOff: IconOff, labelOn, labelOff }) {
  const Icon = on ? IconOn : IconOff
  return (
    <button type="button" onClick={onClick} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-[11px] font-semibold ${on ? 'border-emerald-300 text-emerald-700 dark:text-emerald-400' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}>
      <Icon className="h-3.5 w-3.5" /> {on ? labelOn : labelOff}
    </button>
  )
}

function PeopleTab({ participants, isTeacher, classId, settings, onError }) {
  const call = (path, body) => api.post(`/live-classes/${classId}/${path}`, body).catch((e) => onError(e.message))
  const patch = (body) => api.patch(`/live-classes/${classId}/settings`, body).catch((e) => onError(e.message))
  const sorted = useMemo(() => [...participants].sort((a, b) => {
    const ra = participantRole(a) === ROLE_TEACHER ? 0 : 1
    const rb = participantRole(b) === ROLE_TEACHER ? 0 : 1
    if (ra !== rb) return ra - rb
    const ha = Number(a.attributes?.hand || 0)
    const hb = Number(b.attributes?.hand || 0)
    if (!!ha !== !!hb) return ha ? -1 : 1
    if (ha && hb) return ha - hb
    return (a.name || '').localeCompare(b.name || '')
  }), [participants])

  return (
    <div className="space-y-3 p-3">
      {isTeacher && (
        <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700" data-testid="class-controls">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Class controls</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => call('mute-all')} className="flex items-center gap-1.5 rounded-lg border border-rose-200 px-2 py-1.5 text-[11px] font-semibold text-rose-600"><VolumeX className="h-3.5 w-3.5" /> Mute all</button>
            <Toggle on={!settings.locked} onClick={() => patch({ locked: !settings.locked })} iconOn={Unlock} iconOff={Lock} labelOn="Unlocked" labelOff="Locked" />
            <Toggle on={settings.chat_enabled} onClick={() => patch({ chat_enabled: !settings.chat_enabled })} iconOn={MessageSquare} iconOff={MessageSquareOff} labelOn="Chat on" labelOff="Chat off" />
            <Toggle on={settings.qa_enabled} onClick={() => patch({ qa_enabled: !settings.qa_enabled })} iconOn={HelpCircle} iconOff={HelpCircle} labelOn="Q&A on" labelOff="Q&A off" />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Students may</p>
          <div className="flex flex-wrap gap-1.5">
            <Toggle on={settings.allow_student_mic} onClick={() => patch({ allow_student_mic: !settings.allow_student_mic })} iconOn={Mic} iconOff={MicOff} labelOn="Unmute" labelOff="No mic" />
            <Toggle on={settings.allow_student_camera} onClick={() => patch({ allow_student_camera: !settings.allow_student_camera })} iconOn={Video} iconOff={VideoOff} labelOn="Use camera" labelOff="No camera" />
            <Toggle on={settings.allow_student_screen} onClick={() => patch({ allow_student_screen: !settings.allow_student_screen })} iconOn={MonitorUp} iconOff={MonitorUp} labelOn="Share screen" labelOff="No sharing" />
          </div>
        </div>
      )}
      <ul className="space-y-1.5" data-testid="people-list">
        {sorted.map((p) => {
          const uid = userIdOf(p)
          const role = participantRole(p)
          const micPub = p.getTrackPublication(Track.Source.Microphone)
          const micOn = !!micPub && !micPub.isMuted
          const camPub = p.getTrackPublication(Track.Source.Camera)
          const camOn = !!camPub && !camPub.isMuted
          const hand = p.attributes?.hand
          const request = p.attributes?.request
          const student = role !== ROLE_TEACHER
          return (
            <li key={p.identity} className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700" data-testid="person-row" data-identity={p.identity}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {p.name || p.identity}{p.isLocal ? ' (You)' : ''}
                  {!student && <span className="ml-1 text-[10px] font-bold uppercase text-brand-600">Teacher</span>}
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-slate-400">
                  {hand && <Hand className="h-4 w-4 text-amber-500" aria-label="Hand raised" />}
                  {micOn ? <Mic className="h-4 w-4 text-emerald-500" aria-label="Microphone on" /> : <MicOff className="h-4 w-4" aria-label="Microphone off" />}
                  {camOn ? <Video className="h-4 w-4 text-emerald-500" aria-label="Camera on" /> : <VideoOff className="h-4 w-4" aria-label="Camera off" />}
                </span>
              </div>
              {request && (
                <p className="mt-1 text-[11px] font-semibold text-amber-600">Asks to {request === 'screen' ? 'share screen' : 'speak'}</p>
              )}
              {isTeacher && student && !p.isLocal && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {request === 'speak' && <button type="button" onClick={() => call(`participants/${uid}/permissions`, { microphone: true })} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white">Allow to speak</button>}
                  {request === 'screen' && <button type="button" onClick={() => call(`participants/${uid}/permissions`, { screen: true })} className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white">Allow screen</button>}
                  {micOn && <button type="button" onClick={() => call(`participants/${uid}/mute`, { source: 'microphone' })} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">Mute</button>}
                  <button type="button" onClick={() => call(`participants/${uid}/permissions`, { microphone: !canPublish(p, Track.Source.Microphone) })} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">
                    {canPublish(p, Track.Source.Microphone) ? 'Block mic' : 'Allow mic'}
                  </button>
                  <button type="button" onClick={() => call(`participants/${uid}/permissions`, { camera: !canPublish(p, Track.Source.Camera) })} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">
                    {canPublish(p, Track.Source.Camera) ? 'Block camera' : 'Allow camera'}
                  </button>
                  <button type="button" onClick={() => call(`participants/${uid}/permissions`, { screen: !canPublish(p, Track.Source.ScreenShare) })} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">
                    {canPublish(p, Track.Source.ScreenShare) ? 'Block screen' : 'Allow screen'}
                  </button>
                  {(hand || request) && <button type="button" onClick={() => call(`participants/${uid}/lower-hand`)} className="rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">Lower hand</button>}
                  <button type="button" onClick={() => patch(settings.spotlight === p.identity ? { clear_spotlight: true } : { spotlight: p.identity })} className="flex items-center gap-0.5 rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">
                    <Star className="h-3 w-3" /> {settings.spotlight === p.identity ? 'Unspotlight' : 'Spotlight'}
                  </button>
                  <button
                    type="button"
                    onClick={() => window.confirm(`Remove ${p.name} from the class?`) && call(`participants/${uid}/remove`)}
                    className="flex items-center gap-0.5 rounded border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-600"
                  >
                    <UserMinus className="h-3 w-3" /> Remove
                  </button>
                </div>
              )}
              {isTeacher && !student && p.isLocal && (
                <button type="button" onClick={() => patch(settings.spotlight === p.identity ? { clear_spotlight: true } : { spotlight: p.identity })} className="mt-2 flex items-center gap-0.5 rounded border border-slate-200 px-2 py-1 text-[11px] font-semibold dark:border-slate-700">
                  <Star className="h-3 w-3" /> {settings.spotlight === p.identity ? 'Unspotlight me' : 'Spotlight me'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export default function SidePanel({ tab, setTab, onClose, live, isTeacher, classId }) {
  const [error, setError] = useState(null)
  const { messages, participants, settings } = live
  const chat = messages.filter((m) => m.kind === 'chat' && (isTeacher || !m.hidden))
  const questions = messages.filter((m) => m.kind === 'question' && (isTeacher || !m.hidden))
  const showError = (msg) => {
    setError(msg)
    setTimeout(() => setError(null), 5000)
  }
  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'qa', label: `Q&A${questions.filter((q) => !q.answered).length ? ` (${questions.filter((q) => !q.answered).length})` : ''}` },
    { id: 'people', label: `People (${participants.length})` },
  ]
  return (
    <aside className="flex h-full w-full flex-col border border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 md:w-80 md:rounded-xl" aria-label="Class side panel" data-testid="side-panel">
      <div className="flex items-center justify-between border-b border-slate-200 px-2 dark:border-slate-700">
        <div className="flex" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`px-3 py-2.5 text-xs font-semibold ${tab === t.id ? 'border-b-2 border-brand-600 text-brand-600' : 'text-slate-500'}`}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={onClose} aria-label="Close panel" className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="h-4 w-4" /></button>
      </div>
      {error && <p className="bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 dark:bg-rose-500/10" role="alert">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'chat' && <MessageList items={chat} isTeacher={isTeacher} classId={classId} emptyText="No messages yet." />}
        {tab === 'qa' && <MessageList items={questions} isTeacher={isTeacher} classId={classId} emptyText="No questions yet." question />}
        {tab === 'people' && <PeopleTab participants={participants} isTeacher={isTeacher} classId={classId} settings={settings} onError={showError} />}
      </div>
      {tab === 'chat' && <Composer classId={classId} kind="chat" disabled={!isTeacher && !settings.chat_enabled} placeholder="Message everyone" onError={showError} />}
      {tab === 'qa' && <Composer classId={classId} kind="question" disabled={!isTeacher && !settings.qa_enabled} placeholder="Ask a question" onError={showError} />}
    </aside>
  )
}