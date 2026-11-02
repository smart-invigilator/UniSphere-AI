import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import '../src/index.css'
import { ThemeProvider } from '../src/context/ThemeContext'
import { AuthProvider } from '../src/context/AuthContext'
import { ProctorSessionProvider, useProctorSession } from '../src/context/ProctorSessionContext'
import ExamPage from '../src/pages/student/ExamPage'
import GradingPage from '../src/pages/teacher/GradingPage'
import { api } from '../src/services/api'
import FaceScan360 from '../src/components/face/FaceScan360'
import MathEditorDialog from '../src/components/answer-editor/MathEditorDialog'

const params = new URLSearchParams(window.location.hash.slice(1))
const mode = params.get('mode')
const examId = params.get('exam')
api.setTokens({ access_token: params.get('token'), refresh_token: params.get('refresh') || params.get('token') })

function StudentBoot() {
  const session = useProctorSession()
  const [ready, setReady] = useState(false)
  useEffect(() => {
    ;(async () => {
      const cam = await navigator.mediaDevices.getUserMedia({ video: true })
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true })
      const canvas = document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      const ctx = canvas.getContext('2d')
      setInterval(() => ctx.fillRect(Math.random() * 300, Math.random() * 200, 5, 5), 200)
      session.setCameraStream(cam)
      session.setMicStream(mic)
      session.setScreenStream(canvas.captureStream(5))
      session.setAttempt(Number(params.get('attempt')), Number(examId))
      setReady(true)
    })()
  }, [])
  if (!ready) return <p>Booting…</p>
  return (
    <Routes>
      <Route path="/student/exam/:examId" element={<ExamPage />} />
      <Route path="/student/exam-submitted" element={<div data-testid="submitted-page">Exam submitted</div>} />
      <Route path="*" element={<div data-testid="navigated-away">Navigated away</div>} />
    </Routes>
  )
}

function FaceScanHarness() {
  return (
    <div style={{ maxWidth: 480, margin: '24px auto' }}>
      <FaceScan360
        onComplete={({ frames }) => {
          window.__scanResult = frames.map((f) => f.label)
        }}
      />
    </div>
  )
}

function MathDialogHarness() {
  const [round, setRound] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    window.__openMath = () => {
      setOpen(false)
      setTimeout(() => {
        setRound((r) => r + 1)
        setOpen(true)
      }, 0)
    }
  }, [])
  return open ? (
    <MathEditorDialog
      key={round}
      initialLatex="n=1"
      display={false}
      onSave={(v) => {
        window.__saved = v
        setOpen(false)
      }}
      onCancel={() => setOpen(false)}
    />
  ) : null
}

function App() {
  if (mode === 'facescan') return <FaceScanHarness />
  if (mode === 'mathdialog') return <MathDialogHarness />
  const entry = mode === 'teacher' ? `/teacher/grading/${examId}` : `/student/exam/${examId}`
  return (
    <ThemeProvider>
      <AuthProvider>
        <ProctorSessionProvider>
          <MemoryRouter initialEntries={[entry]}>
            {mode === 'teacher' ? (
              <Routes>
                <Route path="/teacher/grading/:examId" element={<GradingPage />} />
              </Routes>
            ) : (
              <StudentBoot />
            )}
          </MemoryRouter>
        </ProctorSessionProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)