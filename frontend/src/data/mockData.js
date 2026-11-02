// Seed data + generators for the mock real-time layer.
// Replace this module's role by wiring services/socket.js to a real backend.

export const ALERT_TYPES = [
  { type: 'Looking away from screen', severity: 'low' },
  { type: 'No face detected', severity: 'high' },
  { type: 'Multiple faces detected', severity: 'high' },
  { type: 'Mobile phone detected', severity: 'high' },
  { type: 'Suspicious movement', severity: 'medium' },
  { type: 'Left seat', severity: 'medium' },
  { type: 'Tab switching', severity: 'medium' },
  { type: 'Screen anomaly', severity: 'low' },
  { type: 'Unauthorized object detected', severity: 'high' },
]

const FIRST = ['Aisha','Bilal','Chen','Diana','Emir','Fatima','Grace','Hassan','Imran','Jana','Kiran','Leila','Marco','Nadia','Omar','Priya','Qasim','Rhea','Sara','Tariq','Usman','Vera','Wei','Yara','Zain','Noor','Adeel','Sana','Hamza','Maya']
const LAST = ['Khan','Ahmed','Li','Park','Rossi','Silva','Patel','Malik','Cruz','Wong','Iqbal','Shah','Reed','Nawaz','Ali','Raza','Gupta','Mehta','Yousaf','Baig']
const DEPTS = ['Computer Science','Electrical Eng.','Business Admin','Mathematics','Physics','Data Science']
const SESSIONS = ['2024-2025','2023-2024']

let _seq = 1
const pick = (a) => a[Math.floor(Math.random() * a.length)]
const pad = (n, len = 4) => String(n).padStart(len, '0')

export function makeStudent(i) {
  const name = `${pick(FIRST)} ${pick(LAST)}`
  const attention = 55 + Math.floor(Math.random() * 45)
  return {
    id: `STU-${pad(1000 + i)}`,
    name,
    department: pick(DEPTS),
    session: pick(SESSIONS),
    attendance: `${88 + Math.floor(Math.random() * 12)}%`,
    status: 'normal',
    connected: Math.random() > 0.08,
    attention,
    alertCount: 0,
    lastActivity: Date.now() - Math.floor(Math.random() * 60000),
    alerts: [],
    behaviors: [],
    confidence: {
      face: 0.9 + Math.random() * 0.09,
      gaze: 0.82 + Math.random() * 0.15,
      object: 0.78 + Math.random() * 0.2,
    },
    avatarSeed: name.replace(/\s/g, ''),
  }
}

export function makeStudents(n = 12) {
  return Array.from({ length: n }, (_, i) => makeStudent(i))
}

export function makeAlert(student) {
  const t = pick(ALERT_TYPES)
  return {
    id: `ALT-${pad(_seq++, 6)}`,
    studentId: student.id,
    studentName: student.name,
    type: t.type,
    severity: t.severity,
    timestamp: Date.now(),
    reviewed: false,
    notes: '',
    confidence: 0.7 + Math.random() * 0.29,
  }
}
