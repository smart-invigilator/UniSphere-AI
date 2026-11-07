import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ClipboardCheck } from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Avatar from '../../components/Avatar'
import {
  useCourseSubmissions, filterByStudent, SearchBox, CourseGrid,
} from '../../components/teacher/courseSubmissions'

export default function GradingCoursesPage() {
  const { courses } = useExams()
  const { submitted, courseCards } = useCourseSubmissions()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [onlyPending, setOnlyPending] = useState(false)

  const courseId = params.get('course') || null
  const course = courses.find((c) => c.id === courseId)

  const openCourse = (id) => { setSearch(''); setParams({ course: String(id) }) }
  const closeCourse = () => setParams({})

  const rows = useMemo(() => {
    const inCourse = submitted.filter((a) => a.courseId === courseId && (!onlyPending || a.status === 'submitted'))
    return filterByStudent(inCourse, search)
  }, [submitted, courseId, search, onlyPending])

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Grading</h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        {course ? `Students who submitted exams in ${course.title}.` : 'Choose a course to see its submissions.'}
      </p>

      {!course && <CourseGrid cards={courseCards} onSelect={openCourse} />}

      {course && (
        <section className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="outline" onClick={closeCourse}>← All courses</Button>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-500">
                <input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600" />
                Needs grading only
              </label>
              <SearchBox value={search} onChange={setSearch} placeholder="Search by name, email or exam…" />
            </div>
          </div>

          <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
                  <th className="px-4 py-3 font-medium">Student</th>
                  <th className="px-4 py-3 font-medium">Attempt</th>
                  <th className="px-4 py-3 font-medium">Exam</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={a.student_name || 'Student'} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900 dark:text-white">{a.student_name || 'Student'}</p>
                          {a.student_email && <p className="truncate text-xs text-slate-400">{a.student_email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700 dark:text-slate-200">#{a.attemptNo}</td>
                    <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{a.examTitle}</td>
                    <td className="px-4 py-3 font-bold text-slate-700 dark:text-slate-200">{a.final_score ?? a.auto_score}</td>
                    <td className="px-4 py-3"><Badge color={a.status === 'graded' ? 'emerald' : 'amber'}>{a.status === 'graded' ? 'graded' : 'needs grading'}</Badge></td>
                    <td className="px-4 py-3 text-right">
                      <Button as={Link} to={`/teacher/grading/${a.exam_id}?attempt=${a.id}`} size="sm" variant={a.status === 'graded' ? 'outline' : 'primary'} icon={ClipboardCheck}>
                        {a.status === 'graded' ? 'Review' : 'Grade'}
                      </Button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                    {search || onlyPending ? 'No students match your filters.' : 'No submissions for this course yet.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  )
}
