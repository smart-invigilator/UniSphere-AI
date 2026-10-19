const genCode = () => `EXAM-${Math.random().toString(36).slice(2, 7).toUpperCase()}`

export function makeQuestion(type, i) {
  if (type === 'tf') {
    return {
      id: `Q${i}`,
      type: 'tf',
      text: `Statement ${i}: Relational databases enforce referential integrity through foreign keys.`,
      options: ['True', 'False'],
      marks: 2,
    }
  }
  if (type === 'short') {
    return {
      id: `Q${i}`,
      type: 'short',
      text: `Briefly explain concept #${i} covered in this module.`,
      marks: 5,
    }
  }
  return {
    id: `Q${i}`,
    type: 'mcq',
    text: `Question ${i}: Which of the following best describes the core concept being tested?`,
    options: ['Option A — first choice', 'Option B — second choice', 'Option C — third choice', 'Option D — fourth choice'],
    marks: 4,
  }
}

export function makeQuestions(count = 10) {
  const types = ['mcq', 'mcq', 'mcq', 'tf', 'short']
  return Array.from({ length: count }, (_, i) => makeQuestion(types[i % types.length], i + 1))
}

const defaultSecurity = {
  camera: true,
  microphone: true,
  screenShare: true,
  identity: true,
  liveness: true,
}

export const initialExams = [
  {
    id: 'exam-1',
    code: 'EXAM-8F29X',
    title: 'Database Systems Final Exam',
    subject: 'Computer Science',
    description: 'Comprehensive final covering relational design, normalization, transactions, and SQL.',
    duration: 90,
    totalMarks: 100,
    date: '2026-08-17',
    startTime: '14:00',
    endTime: '15:30',
    status: 'active',
    security: defaultSecurity,
    questions: makeQuestions(10),
    candidates: 24,
  },
  {
    id: 'exam-2',
    code: 'EXAM-3K71M',
    title: 'Data Structures Midterm',
    subject: 'Computer Science',
    description: 'Midterm assessment on arrays, linked lists, trees, and complexity analysis.',
    duration: 60,
    totalMarks: 60,
    date: '2026-08-20',
    startTime: '10:00',
    endTime: '11:00',
    status: 'scheduled',
    security: defaultSecurity,
    questions: makeQuestions(8),
    candidates: 18,
  },
  {
    id: 'exam-3',
    code: 'EXAM-9Q45R',
    title: 'Linear Algebra Quiz 3',
    subject: 'Mathematics',
    description: 'Short quiz on eigenvalues, eigenvectors, and matrix diagonalization.',
    duration: 30,
    totalMarks: 30,
    date: '2026-08-10',
    startTime: '09:00',
    endTime: '09:30',
    status: 'completed',
    security: { ...defaultSecurity, screenShare: false },
    questions: makeQuestions(6),
    candidates: 30,
  },
  {
    id: 'exam-4',
    code: 'EXAM-2Z88L',
    title: 'Circuit Theory Assignment',
    subject: 'Electrical Engineering',
    description: 'Draft exam on AC/DC circuit analysis, not yet published to students.',
    duration: 45,
    totalMarks: 50,
    date: '2026-08-25',
    startTime: '13:00',
    endTime: '13:45',
    status: 'draft',
    security: defaultSecurity,
    questions: makeQuestions(5),
    candidates: 0,
  },
]

export function createBlankExam() {
  return {
    id: `exam-${Date.now()}`,
    code: genCode(),
    title: '',
    subject: '',
    description: '',
    duration: 60,
    totalMarks: 100,
    date: '',
    startTime: '',
    endTime: '',
    status: 'draft',
    security: { ...defaultSecurity },
    questions: [],
    candidates: 0,
  }
}

export const STUDENT_ROSTER = [
  { id: 'STU-1001', name: 'Aisha Khan', email: 'aisha.khan@campus.edu', examsParticipated: 6, lastActivity: Date.now() - 3600_000, status: 'active' },
  { id: 'STU-1002', name: 'Bilal Ahmed', email: 'bilal.ahmed@campus.edu', examsParticipated: 4, lastActivity: Date.now() - 7200_000, status: 'active' },
  { id: 'STU-1003', name: 'Chen Li', email: 'chen.li@campus.edu', examsParticipated: 8, lastActivity: Date.now() - 86_400_000, status: 'inactive' },
  { id: 'STU-1004', name: 'Diana Park', email: 'diana.park@campus.edu', examsParticipated: 5, lastActivity: Date.now() - 1800_000, status: 'active' },
  { id: 'STU-1005', name: 'Emir Rossi', email: 'emir.rossi@campus.edu', examsParticipated: 2, lastActivity: Date.now() - 172_800_000, status: 'flagged' },
  { id: 'STU-1006', name: 'Fatima Silva', email: 'fatima.silva@campus.edu', examsParticipated: 7, lastActivity: Date.now() - 5400_000, status: 'active' },
  { id: 'STU-1007', name: 'Grace Patel', email: 'grace.patel@campus.edu', examsParticipated: 3, lastActivity: Date.now() - 9000_000, status: 'active' },
  { id: 'STU-1008', name: 'Hassan Malik', email: 'hassan.malik@campus.edu', examsParticipated: 6, lastActivity: Date.now() - 43_200_000, status: 'flagged' },
]

export const STATUS_META = {
  draft: { label: 'Draft', color: 'slate' },
  published: { label: 'Published', color: 'brand' },
  scheduled: { label: 'Scheduled', color: 'violet' },
  active: { label: 'Active', color: 'emerald' },
  closed: { label: 'Closed', color: 'rose' },
  completed: { label: 'Completed', color: 'slate' },
  upcoming: { label: 'Upcoming', color: 'violet' },
  available: { label: 'Available', color: 'emerald' },
  missed: { label: 'Missed', color: 'rose' },
}