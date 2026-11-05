import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Room, Track } from 'livekit-client'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MonitorOff, Hand, Smile, MessageSquare, Users, LayoutGrid, Presentation,
  Maximize, Minimize, Settings2, Info, PhoneOff, Loader2, WifiOff, Volume2, Copy, X, Lock, SwitchCamera, Clock,
} from 'lucide-react'
import { api } from '../../services/api'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'
import { useLiveRoom } from '../../components/live/useLiveRoom'
import MeetingStage from '../../components/live/MeetingStage'
import SidePanel from '../../components/live/SidePanel'
import PreJoin, { DeviceSelect } from '../../components/live/PreJoin'
import { REACTIONS, canPublish, formatDuration, mediaErrorMessage } from '../../components/live/liveUtils'

function Duration({ startedAt }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  if (!startedAt) return null
  return (
    <span className="flex items-center gap-1 tabular-nums" data-testid="duration">
      <Clock className="h-3.5 w-3.5" /> {formatDuration((now - new Date(startedAt).getTime()) / 1000)}
    </span>
  )
}

function ControlButton({ onClick, active, danger, label, icon: Icon, disabled, badge, testId, pressed }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      data-testid={testId}
      className={`relative flex h-11 min-w-11 items-center justify-center rounded-full px-3 text-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:opacity-40 ${
        danger ? 'bg-rose-600 hover:bg-rose-700' : active ? 'bg-brand-600 hover:bg-brand-700' : 'bg-white/10 hover:bg-white/20'
      }`}
    >
      <Icon className="h-5 w-5" />
      {badge ? <span className="absolute -right-1 -top-1 rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-amber-950">{badge}</span> : null}
    </button>
  )
}

function DeviceSettings({ room, open, onClose, pushNotice }) {
  const [devices, setDevices] = useState({ audioinput: [], videoinput: [], audiooutput: [] })
  const [active, setActive] = useState({})
  const supportsOutput = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype
  useEffect(() => {
    if (!open || !room) return
    Promise.all(['audioinput', 'videoinput', 'audiooutput'].map((k) => Room.getLocalDevices(k).catch(() => [])))
      .then(([a, v, o]) => setDevices({ audioinput: a, videoinput: v, audiooutput: o }))
    setActive({
      audioinput: room.getActiveDevice('audioinput'),
      videoinput: room.getActiveDevice('videoinput'),
      audiooutput: room.getActiveDevice('audiooutput'),
    })
  }, [open, room])
  const change = async (kind, id) => {
    try {
      await room.switchActiveDevice(kind, id)
      setActive((a) => ({ ...a, [kind]: id }))
    } catch (err) {
      pushNotice(mediaErrorMessage(err, kind === 'audioinput' ? 'microphone' : kind === 'videoinput' ? 'camera' : 'speaker'), 'error')
    }
  }
  const flip = async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera)
    const track = pub?.videoTrack
    if (!track) return pushNotice('Turn on your camera first.', 'warning')
    const facing = track.mediaStreamTrack?.getSettings?.().facingMode === 'environment' ? 'user' : 'environment'
    try {
      await track.restartTrack({ facingMode: facing })
    } catch (err) {
      pushNotice(mediaErrorMessage(err, 'camera'), 'error')
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Audio & video settings">
      <div className="space-y-3">
        <DeviceSelect kind="audioinput" label="Microphone" value={active.audioinput} devices={devices.audioinput} onChange={(v) => change('audioinput', v)} />
        <DeviceSelect kind="videoinput" label="Camera" value={active.videoinput} devices={devices.videoinput} onChange={(v) => change('videoinput', v)} />
        {supportsOutput ? (
          <DeviceSelect kind="audiooutput" label="Speaker" value={active.audiooutput} devices={devices.audiooutput} onChange={(v) => change('audiooutput', v)} />
        ) : (
          <p className="text-xs text-slate-400">Speaker selection isn't supported by this browser — it uses your system's default output.</p>
        )}
        {devices.videoinput.length > 1 && (
          <Button variant="outline" size="sm" icon={SwitchCamera} onClick={flip}>Switch front / rear camera</Button>
        )}
      </div>
    </Modal>
  )
}

export default function LiveClassRoom() {
  const { classId } = useParams()
  const navigate = useNavigate()
  const stageRef = useRef(null)
  const live = useLiveRoom(classId)
  const [liveClass, setLiveClass] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [layout, setLayout] = useState('speaker')
  const [pinned, setPinned] = useState(null)
  const [panel, setPanel] = useState(null)
  const [showReactions, setShowReactions] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [busy, setBusy] = useState(false)

  const role = live.info?.role || liveClass?.my_role
  const isTeacher = role === 'teacher'
  const backPath = isTeacher ? '/teacher/live-classes' : '/student/live-classes'

  useEffect(() => {
    let cancelled = false
    let timer = null
    const load = async () => {
      try {
        const lc = await api.get(`/live-classes/${classId}`)
        if (cancelled) return
        setLiveClass(lc)
        if (lc.status === 'scheduled' && lc.my_role !== 'teacher') timer = setTimeout(load, 10000)
      } catch (err) {
        if (!cancelled) setLoadError(err.message)
      }
    }
    load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [classId])

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const handleJoin = async (opts) => {
    if (liveClass?.status === 'scheduled' && liveClass?.my_role === 'teacher') {
      try {
        setLiveClass(await api.post(`/live-classes/${classId}/start`))
      } catch (err) {
        live.setError(err.message)
        return
      }
    }
    await live.join(opts)
  }

  const room = live.room
  const lp = room?.localParticipant
  const micOn = !!lp?.isMicrophoneEnabled
  const camOn = !!lp?.isCameraEnabled
  const screenOn = !!lp?.isScreenShareEnabled
  const mayMic = isTeacher || canPublish(lp, Track.Source.Microphone)
  const mayCam = isTeacher || canPublish(lp, Track.Source.Camera)
  const mayScreen = isTeacher || canPublish(lp, Track.Source.ScreenShare)
  const myHand = !!lp?.attributes?.hand
  const myRequest = lp?.attributes?.request || ''
  const hands = live.participants.filter((p) => p.attributes?.hand || p.attributes?.request).length

  const request = useCallback(async (kind) => {
    try {
      await api.post(`/live-classes/${classId}/request`, { kind: myRequest === kind ? '' : kind })
      live.pushNotice(myRequest === kind ? 'Request withdrawn.' : 'Request sent to the teacher.')
    } catch (err) {
      live.pushNotice(err.message, 'error')
    }
  }, [classId, live, myRequest])

  const toggleMic = async () => {
    if (!mayMic) return request('speak')
    try {
      await lp.setMicrophoneEnabled(!micOn)
    } catch (err) {
      live.pushNotice(mediaErrorMessage(err, 'microphone'), 'error')
    }
    live.refresh()
  }
  const toggleCamera = async () => {
    if (!mayCam) return live.pushNotice('The teacher has turned off student cameras.', 'warning')
    try {
      await lp.setCameraEnabled(!camOn)
    } catch (err) {
      live.pushNotice(mediaErrorMessage(err, 'camera'), 'error')
    }
    live.refresh()
  }
  const toggleScreen = async () => {
    if (!mayScreen) return request('screen')
    try {
      await lp.setScreenShareEnabled(!screenOn, { audio: true, contentHint: 'detail', selfBrowserSurface: 'exclude', surfaceSwitching: 'include', systemAudio: 'include' })
    } catch (err) {
      if (err?.name !== 'NotAllowedError' || !/denied by system|Permission denied/i.test(err?.message || '')) {
        live.pushNotice(mediaErrorMessage(err, 'screen'), 'error')
      }
    }
    live.refresh()
  }
  const toggleHand = async () => {
    try {
      await api.post(`/live-classes/${classId}/hand`, { raised: !myHand })
    } catch (err) {
      live.pushNotice(err.message, 'error')
    }
  }
  const react = async (emoji) => {
    setShowReactions(false)
    try {
      await api.post(`/live-classes/${classId}/reactions`, { emoji })
    } catch (err) {
      live.pushNotice(err.message, 'error')
    }
  }
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen()
    else stageRef.current?.requestFullscreen?.()
  }
  const leave = async () => {
    await live.leave()
    navigate(backPath)
  }
  const endForAll = async () => {
    if (!window.confirm('End this class for everyone?')) return
    setBusy(true)
    try {
      await api.post(`/live-classes/${classId}/end`)
      await live.leave()
      navigate(backPath)
    } catch (err) {
      live.pushNotice(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }
  const togglePanel = (tab) => setPanel((p) => (p === tab ? null : tab))

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-white">
        <p className="text-lg font-semibold">{loadError}</p>
        <Button onClick={() => navigate(-1)}>Go back</Button>
      </div>
    )
  }
  if (!liveClass) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300"><Loader2 className="h-6 w-6 animate-spin" /></div>
  }
  if (live.phase === 'ended' || live.phase === 'left' || liveClass.status === 'ended' || liveClass.status === 'cancelled') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-white" data-testid="class-ended">
        <p className="text-lg font-semibold">
          {live.endedReason || (live.phase === 'left' ? 'You left the class.' : liveClass.status === 'cancelled' ? 'This class was cancelled.' : 'This class has ended.')}
        </p>
        <div className="flex gap-2">
          {live.phase === 'left' && liveClass.status === 'live' && <Button onClick={() => window.location.reload()}>Rejoin</Button>}
          <Button variant="outline" onClick={() => navigate(backPath)}>Back to live classes</Button>
        </div>
      </div>
    )
  }
  if (live.phase === 'prejoin' || live.phase === 'joining') {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
        <PreJoin liveClass={liveClass} role={liveClass.my_role} onJoin={handleJoin} joining={live.phase === 'joining'} error={live.error} />
      </div>
    )
  }
  if (live.phase === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-950 p-6 text-center text-white">
        <WifiOff className="h-8 w-8 text-rose-400" />
        <p className="max-w-md text-base font-semibold">{live.error}</p>
        <Button onClick={() => window.location.reload()}>Try again</Button>
      </div>
    )
  }

  const settings = live.settings || {}
  return (
    <div className="flex h-[100dvh] flex-col bg-slate-950 text-white" data-testid="live-room" data-phase={live.phase}>
      <header className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
        <div className="min-w-0">
          <p className="truncate font-semibold">{liveClass.title}</p>
          <p className="truncate text-[11px] text-slate-400">{liveClass.course_title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-slate-300">
          {settings.locked && <span className="flex items-center gap-1 text-amber-300"><Lock className="h-3.5 w-3.5" /> Locked</span>}
          <Duration startedAt={live.info?.live_class?.started_at || liveClass.started_at} />
          <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" /> {live.participants.length}</span>
        </div>
      </header>

      {(live.phase === 'reconnecting' || live.phase === 'rejoining') && (
        <div className="mx-4 flex items-center gap-2 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200" role="status" data-testid="reconnecting">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Connection lost — reconnecting you to the class…
        </div>
      )}
      {live.audioBlocked && (
        <button type="button" onClick={live.startAudio} className="mx-4 mt-1 flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold">
          <Volume2 className="h-4 w-4" /> Click to turn on class audio
        </button>
      )}

      <main className="flex min-h-0 flex-1 gap-2 p-2">
        <div ref={stageRef} className="relative min-w-0 flex-1 bg-slate-950">
          <MeetingStage room={room} participants={live.participants} layout={layout} pinned={pinned} setPinned={setPinned} spotlight={settings.spotlight} />
          <div className="pointer-events-none absolute bottom-4 left-4 flex flex-col-reverse gap-1" aria-live="polite">
            {live.reactions.map((r) => (
              <span key={r.id} className="animate-bounce rounded-full bg-black/50 px-3 py-1 text-sm" data-testid="reaction">
                <span className="text-xl">{r.emoji}</span> <span className="text-xs text-slate-200">{r.name}</span>
              </span>
            ))}
          </div>
        </div>
        {panel && (
          <div className="fixed inset-0 z-30 md:static md:z-auto">
            <SidePanel tab={panel} setTab={setPanel} onClose={() => setPanel(null)} live={live} isTeacher={isTeacher} classId={classId} />
          </div>
        )}
      </main>

      <div className="pointer-events-none fixed right-4 top-14 z-40 flex w-72 flex-col gap-2" aria-live="polite">
        {live.notices.map((n) => (
          <div key={n.id} className={`rounded-lg px-3 py-2 text-xs font-medium shadow-lg ${n.tone === 'error' ? 'bg-rose-600' : n.tone === 'warning' ? 'bg-amber-500 text-amber-950' : 'bg-slate-800'}`} data-testid="notice">
            {n.text}
          </div>
        ))}
      </div>

      <footer className="flex flex-wrap items-center justify-center gap-2 px-2 pb-3 pt-1" role="toolbar" aria-label="Class controls">
        <ControlButton testId="ctl-mic" onClick={toggleMic} danger={mayMic && !micOn} pressed={micOn} active={!mayMic && myRequest === 'speak'} icon={mayMic ? (micOn ? Mic : MicOff) : Hand} label={mayMic ? (micOn ? 'Mute microphone' : 'Unmute microphone') : myRequest === 'speak' ? 'Cancel request to speak' : 'Ask to speak'} />
        <ControlButton testId="ctl-camera" onClick={toggleCamera} danger={mayCam && !camOn} pressed={camOn} disabled={!mayCam} icon={camOn ? Video : VideoOff} label={camOn ? 'Turn camera off' : 'Turn camera on'} />
        <ControlButton testId="ctl-screen" onClick={toggleScreen} active={screenOn || (!mayScreen && myRequest === 'screen')} icon={screenOn ? MonitorOff : MonitorUp} label={mayScreen ? (screenOn ? 'Stop sharing' : 'Share screen') : myRequest === 'screen' ? 'Cancel screen request' : 'Ask to share screen'} />
        {!isTeacher && <ControlButton testId="ctl-hand" onClick={toggleHand} active={myHand} pressed={myHand} icon={Hand} label={myHand ? 'Lower hand' : 'Raise hand'} />}
        <div className="relative">
          <ControlButton testId="ctl-react" onClick={() => setShowReactions((v) => !v)} icon={Smile} label="Reactions" />
          {showReactions && (
            <div className="absolute bottom-14 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-slate-800 p-1.5 shadow-xl">
              {REACTIONS.map((e) => (
                <button key={e} type="button" onClick={() => react(e)} className="rounded-full px-1.5 py-1 text-xl hover:bg-white/10" aria-label={`React ${e}`}>{e}</button>
              ))}
            </div>
          )}
        </div>
        <ControlButton testId="ctl-chat" onClick={() => togglePanel('chat')} active={panel === 'chat'} icon={MessageSquare} label="Chat and questions" />
        <ControlButton testId="ctl-people" onClick={() => togglePanel('people')} active={panel === 'people'} icon={Users} label="Participants" badge={isTeacher && hands ? hands : null} />
        <ControlButton onClick={() => setLayout((l) => (l === 'grid' ? 'speaker' : 'grid'))} icon={layout === 'grid' ? Presentation : LayoutGrid} label={layout === 'grid' ? 'Speaker view' : 'Grid view'} testId="ctl-layout" />
        <ControlButton onClick={toggleFullscreen} icon={fullscreen ? Minimize : Maximize} label={fullscreen ? 'Exit full screen' : 'Full screen'} />
        <ControlButton onClick={() => setShowDevices(true)} icon={Settings2} label="Audio and video settings" />
        <ControlButton onClick={() => setShowInfo(true)} icon={Info} label="Meeting information" />
        <ControlButton testId="ctl-leave" onClick={leave} danger icon={PhoneOff} label="Leave class" />
        {isTeacher && (
          <button type="button" onClick={endForAll} disabled={busy} data-testid="ctl-end" className="h-11 rounded-full bg-rose-700 px-4 text-sm font-semibold hover:bg-rose-800 disabled:opacity-50">
            End for everyone
          </button>
        )}
      </footer>

      <DeviceSettings room={room} open={showDevices} onClose={() => setShowDevices(false)} pushNotice={live.pushNotice} />
      <Modal open={showInfo} onClose={() => setShowInfo(false)} title="Meeting information">
        <MeetingInfo liveClass={liveClass} participants={live.participants.length} />
      </Modal>
    </div>
  )
}

function MeetingInfo({ liveClass, participants }) {
  const link = `${window.location.origin}/live/join/${liveClass.meeting_code}`
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-xs font-semibold uppercase text-slate-400">Meeting code</p>
        <p className="font-mono text-lg font-bold" data-testid="meeting-code">{liveClass.meeting_code}</p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-slate-400">Joining link (enrolled students only)</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs dark:bg-slate-800">{link}</code>
          <Button size="sm" variant="outline" icon={copied ? X : Copy} onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
        </div>
      </div>
      <p className="text-slate-500">{liveClass.course_title} · {participants} in the class · teacher {liveClass.teacher_name}</p>
    </div>
  )
}