import { Routes, Route } from 'react-router-dom'
import {
  LayoutDashboard, FileText, PlusSquare, Radar, Users, FileBarChart2, Settings, BookOpen,
  Radio, ClipboardCheck,
} from 'lucide-react'
import { ThemeProvider } from './context/ThemeContext'
import { MonitorProvider } from './context/MonitorContext'
import { AuthProvider } from './context/AuthContext'
import { ExamProvider } from './context/ExamContext'
import { ProctorSessionProvider } from './context/ProctorSessionContext'
import Toasts from './components/Toasts'
import NotifyToasts from './components/NotifyToasts'
import { NotifyProvider } from './context/NotifyContext'
import ProtectedRoute from './components/layout/ProtectedRoute'
import DashboardLayout from './components/layout/DashboardLayout'
import AppNavbar from './components/layout/AppNavbar'

import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import PhoneCameraPage from './pages/phone/PhoneCameraPage'

import StudentDashboard from './pages/student/StudentDashboard'
import PreExamCheck from './pages/student/PreExamCheck'
import ExamPage from './pages/student/ExamPage'
import ExamSubmitted from './pages/student/ExamSubmitted'
import StudentExamResults from './pages/student/StudentExamResults'

import TeacherDashboard from './pages/teacher/TeacherDashboard'
import ExamsPage from './pages/teacher/ExamsPage'
import CreateExam from './pages/teacher/CreateExam'
import LiveMonitoring from './pages/teacher/LiveMonitoring'
import StudentsPage from './pages/teacher/StudentsPage'
import ReportsPage from './pages/teacher/ReportsPage'
import SettingsPage from './pages/teacher/SettingsPage'
import CoursesPage from './pages/teacher/CoursesPage'
import CourseDetail from './pages/teacher/CourseDetail'
import GradingPage from './pages/teacher/GradingPage'
import GradingCoursesPage from './pages/teacher/GradingCoursesPage'
import LiveClassesPage from './pages/teacher/LiveClassesPage'
import StudentLiveClasses from './pages/student/StudentLiveClasses'
import LiveClassRoom from './pages/live/LiveClassRoom'
import JoinByCode from './pages/live/JoinByCode'

const TEACHER_NAV = [
  { to: '/teacher/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/teacher/courses', label: 'Courses', icon: BookOpen },
  { to: '/teacher/exams', label: 'Exams', icon: FileText },
  { to: '/teacher/create-exam', label: 'Create Exam', icon: PlusSquare },
  { to: '/teacher/grading', label: 'Grading', icon: ClipboardCheck },
  { to: '/teacher/live-classes', label: 'Live Classes', icon: Radio },
  { to: '/teacher/students', label: 'Students', icon: Users },
  { to: '/teacher/reports', label: 'Reports', icon: FileBarChart2 },
  { to: '/teacher/settings', label: 'Settings', icon: Settings },
]

export default function App() {
  return (
    <ThemeProvider>
      <NotifyProvider>
      <AuthProvider>
        <ExamProvider>
          <ProctorSessionProvider>
          <MonitorProvider>
            <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />
                {/* Opened on the student's phone from the exam QR code (no login; token in URL) */}
                <Route path="/phone-camera/:token" element={<PhoneCameraPage />} />

                {/* Student flow (own header per page, no sidebar) */}
                <Route
                  path="/student/dashboard"
                  element={
                    <ProtectedRoute role="student">
                      <AppNavbar />
                      <StudentDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/live-classes"
                  element={
                    <ProtectedRoute role="student">
                      <AppNavbar />
                      <StudentLiveClasses />
                    </ProtectedRoute>
                  }
                />
                <Route path="/live/join/:code" element={<ProtectedRoute><JoinByCode /></ProtectedRoute>} />
                <Route path="/live/:classId" element={<ProtectedRoute><LiveClassRoom /></ProtectedRoute>} />
                <Route path="/student/checklist/:examId" element={<ProtectedRoute role="student"><PreExamCheck /></ProtectedRoute>} />
                <Route path="/student/exam/:examId" element={<ProtectedRoute role="student"><ExamPage /></ProtectedRoute>} />
                <Route path="/student/exam-submitted" element={<ProtectedRoute role="student"><ExamSubmitted /></ProtectedRoute>} />
                <Route path="/student/exam-results/:attemptId" element={<ProtectedRoute role="student"><AppNavbar /><StudentExamResults /></ProtectedRoute>} />

                {/* Teacher flow (sidebar layout) */}
                <Route element={<ProtectedRoute role="teacher"><DashboardLayout items={TEACHER_NAV} /></ProtectedRoute>}>
                  <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
                  <Route path="/teacher/courses" element={<CoursesPage />} />
                  <Route path="/teacher/courses/:courseId" element={<CourseDetail />} />
                  <Route path="/teacher/exams" element={<ExamsPage />} />
                  <Route path="/teacher/create-exam" element={<CreateExam />} />
                  <Route path="/teacher/live-classes" element={<LiveClassesPage />} />
                  <Route path="/teacher/monitoring/:examId" element={<LiveMonitoring />} />
                  <Route path="/teacher/grading" element={<GradingCoursesPage />} />
                  <Route path="/teacher/grading/:examId" element={<GradingPage />} />
                  <Route path="/teacher/students" element={<StudentsPage />} />
                  <Route path="/teacher/reports" element={<ReportsPage />} />
                  <Route path="/teacher/settings" element={<SettingsPage />} />
                </Route>

                <Route path="*" element={<LandingPage />} />
              </Routes>
              <Toasts />
              <NotifyToasts />
            </div>
          </MonitorProvider>
          </ProctorSessionProvider>
        </ExamProvider>
      </AuthProvider>
      </NotifyProvider>
    </ThemeProvider>
  )
}