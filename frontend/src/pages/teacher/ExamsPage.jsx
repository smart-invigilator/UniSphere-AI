import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Radar, CheckCircle2, Copy, ClipboardCheck, Pencil, Trash2, AlertTriangle } from 'lucide-react'
import { useExams } from '../../context/ExamContext'
import { STATUS_META } from '../../data/examData'
import { Badge } from '../../components/common/EmptyState'
import Button from '../../components/common/Button'
import Modal from '../../components/common/Modal'

export default function ExamsPage() {
  const { exams, publishExam, deleteExam, loading } = useExams()
  const [copied, setCopied] = useState(null)
  const [publishing, setPublishing] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  const copyCode = (code) => {
    navigator.clipboard?.writeText(code).catch(() => {})
    setCopied(code)
    setTimeout(() => setCopied(null), 1500)
  }

  const handlePublish = async (examId) => {
    setPublishing(examId)
    try {
      await publishExam(examId)
    } finally {
      setPublishing(null)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteExam(deleteTarget.id)
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err.message || 'Could not delete this exam.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Exams</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Create, publish, and manage every exam across your courses.</p>
        </div>
        <Button as={Link} to="/teacher/create-exam" icon={Plus}>Create Exam</Button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400 dark:border-slate-800">
              <th className="px-4 py-3 font-medium">Exam Title</th>
              <th className="px-4 py-3 font-medium">Course</th>
              <th className="px-4 py-3 font-medium">Duration</th>
              <th className="px-4 py-3 font-medium">Questions</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {exams.map((exam) => (
              <tr key={exam.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-4 py-3">
                  <p className="font-semibold text-slate-900 dark:text-white">{exam.title}</p>
                  <button onClick={() => copyCode(exam.code)} className="mt-0.5 inline-flex items-center gap-1 font-mono text-[11px] text-slate-400 hover:text-brand-600">
                    <Copy className="h-3 w-3" /> {copied === exam.code ? 'Copied!' : exam.code}
                  </button>
                </td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{exam.course_title}</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{exam.duration_minutes} min</td>
                <td className="px-4 py-3 text-slate-500 dark:text-slate-400">{exam.question_count}</td>
                <td className="px-4 py-3">
                  <Badge color={exam.is_closed ? STATUS_META.closed.color : (STATUS_META[exam.status]?.color || 'slate')}>
                    {exam.is_closed ? STATUS_META.closed.label : (STATUS_META[exam.status]?.label || exam.status)}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {exam.status === 'draft' && (
                      <>
                        <Button size="sm" variant="secondary" icon={CheckCircle2} disabled={publishing === exam.id} onClick={() => handlePublish(exam.id)}>
                          {publishing === exam.id ? 'Publishing…' : 'Publish'}
                        </Button>
                        <Button as={Link} to={`/teacher/create-exam?edit=${exam.id}`} size="sm" variant="outline" icon={Pencil}>Edit</Button>
                      </>
                    )}
                    {(exam.status === 'published' || exam.status === 'active') && !exam.is_closed && (
                      <Button as={Link} to={`/teacher/monitoring/${exam.id}`} size="sm" icon={Radar}>Monitor</Button>
                    )}
                    <Button as={Link} to={`/teacher/grading/${exam.id}`} size="sm" variant="outline" icon={ClipboardCheck}>Grade</Button>
                    <button
                      onClick={() => { setDeleteTarget(exam); setDeleteError(null) }}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10"
                      title="Delete exam"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && exams.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                No exams yet. <Link to="/teacher/create-exam" className="text-brand-600 hover:underline">Create one</Link>.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete this exam?"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete Exam'}</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This permanently deletes <span className="font-semibold">{deleteTarget?.title}</span> and all of its questions.
          This can't be undone.
        </p>
        {deleteError && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {deleteError}
          </p>
        )}
      </Modal>
    </main>
  )
}