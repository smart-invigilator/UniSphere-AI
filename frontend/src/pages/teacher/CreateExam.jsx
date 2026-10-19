import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  BookOpen,
  Info,
  CalendarDays,
  ShieldCheck,
  ListChecks,
  FileCheck2,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  Copy,
  PartyPopper,
  CheckCircle2,
  Loader2,
} from "lucide-react";
import { useExams } from "../../context/ExamContext";
import { api } from "../../services/api";
import { Stepper } from "../../components/common/ProgressBar";
import Button from "../../components/common/Button";
import Modal from "../../components/common/Modal";

const STEPS = [
  "Course",
  "Basic Info",
  "Schedule",
  "Security",
  "Questions",
  "Review",
];

const SECURITY_TOGGLES = [
  {
    key: "camera",
    label: "Require Camera",
    desc: "Candidates must enable their webcam before starting.",
  },
  {
    key: "microphone",
    label: "Require Microphone",
    desc: "Audio is monitored for the full session.",
  },
  {
    key: "screenShare",
    label: "Require Screen Sharing",
    desc: "Candidates must share their entire screen.",
  },
  {
    key: "identity",
    label: "Require Identity Verification",
    desc: "Face is enrolled and re-checked against you throughout the exam (ArcFace).",
  },
  {
    key: "liveness",
    label: "Require Liveness Detection",
    desc: "Candidates complete a short head-turn challenge to rule out a static photo.",
  },
];

const blankQuestion = (type) => ({
  localId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  type,
  text: "",
  marks: type === "short" ? 8 : type === "tf" ? 2 : 4,
  options:
    type === "mcq"
      ? ["", "", "", ""]
      : type === "tf"
        ? ["True", "False"]
        : null,
  correctIndex: 0,
});

const blankExam = () => ({
  courseId: null,
  title: "",
  description: "",
  duration_minutes: 60,
  scheduled_start: "",
  scheduled_end: "",
  security: {
    camera: true,
    microphone: true,
    screenShare: true,
    identity: true,
    liveness: true,
  },
  questions: [],
});
function questionFromApi(q) {
  const options = q.type === "short" ? null : q.options || [];
  const correctIndex =
    q.type === "short"
      ? 0
      : Math.max(
          0,
          options.findIndex((o) => o === q.correct_answer),
        );
  return {
    localId: `q-${q.id}`,
    type: q.type,
    text: q.text,
    marks: q.marks,
    options,
    correctIndex: correctIndex < 0 ? 0 : correctIndex,
  };
}
function toLocalDatetimeInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateExam() {
  const { courses, createExam, updateExam, publishExam } = useExams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditing = !!editId;

  const [step, setStep] = useState(0);
  const [exam, setExam] = useState(blankExam());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); 
  const [loadingExisting, setLoadingExisting] = useState(isEditing);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    (async () => {
      setLoadingExisting(true);
      setLoadError(null);
      try {
        const [e, qs] = await Promise.all([
          api.get(`/exams/${editId}`),
          api.get(`/exams/${editId}/questions`),
        ]);
        if (cancelled) return;
        if (e.status !== "draft") {
          setLoadError(
            "This exam has already been published and can no longer be edited.",
          );
          return;
        }
        setExam({
          courseId: e.course_id,
          title: e.title,
          description: e.description,
          duration_minutes: e.duration_minutes,
          scheduled_start: toLocalDatetimeInput(e.scheduled_start),
          scheduled_end: toLocalDatetimeInput(e.scheduled_end),
          security: e.security,
          questions: qs.map(questionFromApi),
        });
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Could not load this exam");
      } finally {
        if (!cancelled) setLoadingExisting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditing, editId]);

  const set = (patch) => setExam((e) => ({ ...e, ...patch }));
  const setSecurity = (key) =>
    setExam((e) => ({
      ...e,
      security: { ...e.security, [key]: !e.security[key] },
    }));

  const addQuestion = (type) =>
    set({ questions: [...exam.questions, blankQuestion(type)] });
  const updateQuestion = (id, patch) =>
    set({
      questions: exam.questions.map((q) =>
        q.localId === id ? { ...q, ...patch } : q,
      ),
    });
  const removeQuestion = (id) =>
    set({ questions: exam.questions.filter((q) => q.localId !== id) });

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const canProceed = () => {
    if (step === 0) return !!exam.courseId;
    if (step === 1) return exam.title.trim().length > 1;
    if (step === 4)
      return (
        exam.questions.length > 0 && exam.questions.every((q) => q.text.trim())
      );
    return true;
  };

  const buildPayload = () => ({
    course_id: exam.courseId,
    title: exam.title,
    description: exam.description,
    duration_minutes: Number(exam.duration_minutes) || 60,
    scheduled_start: exam.scheduled_start || null,
    scheduled_end: exam.scheduled_end || null,
    security: exam.security,
    questions: exam.questions.map((q) => ({
      type: q.type,
      text: q.text,
      options: q.type === "short" ? null : q.options,
      correct_answer:
        q.type === "short" ? null : (q.options?.[q.correctIndex] ?? null),
      marks: Number(q.marks) || 1,
    })),
  });

  const save = async (publish) => {
    setSaving(true);
    setError(null);
    try {
      const saved = isEditing
        ? await updateExam(editId, buildPayload())
        : await createExam(buildPayload());
      if (publish) {
        const published = await publishExam(saved.id);
        setResult(published);
      } else {
        setResult(saved);
      }
    } catch (e) {
      setError(e.message || "Could not save the exam");
    } finally {
      setSaving(false);
    }
  };

  const selectedCourse = courses.find((c) => c.id === exam.courseId);

  if (loadingExisting) {
    return (
      <main className="mx-auto flex max-w-3xl items-center justify-center gap-2 px-4 py-20 text-sm text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading exam…
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {loadError}
        </p>
        <Link
          to="/teacher/exams"
          className="mt-2 inline-block text-sm font-medium text-brand-600 hover:underline"
        >
          Back to Exams
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">
        {isEditing ? "Edit Exam" : "Create Exam"}
      </h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        {isEditing
          ? "Update the schedule, security, or questions for this draft exam."
          : "Build out the course, schedule, security, and questions."}
      </p>

      <div className="mt-6">
        <Stepper steps={STEPS} current={step} />
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        {step === 0 && (
          <StepShell icon={BookOpen} title="Select Course">
            {isEditing ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-800">
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                  {selectedCourse?.title || "Loading…"}
                </p>
                <p className="text-xs text-slate-400">
                  An exam's course can't be changed after it's created.
                </p>
              </div>
            ) : courses.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400 dark:border-slate-700">
                You don't have any courses yet.{" "}
                <Link
                  to="/teacher/courses"
                  className="font-medium text-brand-600 hover:underline"
                >
                  Create one first
                </Link>
                .
              </p>
            ) : (
              <div className="space-y-2">
                {courses.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border p-3 ${
                      exam.courseId === c.id
                        ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                        : "border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                    }`}
                  >
                    <span>
                      <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                        {c.title}
                      </span>
                      <span className="block text-xs text-slate-400">
                        {c.subject} · {c.student_count} students
                      </span>
                    </span>
                    <input
                      type="radio"
                      name="course"
                      checked={exam.courseId === c.id}
                      onChange={() => set({ courseId: c.id })}
                      className="h-4 w-4 text-brand-600"
                    />
                  </label>
                ))}
              </div>
            )}
          </StepShell>
        )}

        {step === 1 && (
          <StepShell icon={Info} title="Basic Information">
            <Field
              label="Exam Title"
              value={exam.title}
              onChange={(v) => set({ title: v })}
              placeholder="Database Systems Final Exam"
            />
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Description
              </label>
              <textarea
                rows={3}
                value={exam.description}
                onChange={(e) => set({ description: e.target.value })}
                placeholder="What does this exam cover?"
                className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
            <Field
              label="Duration (minutes)"
              type="number"
              value={exam.duration_minutes}
              onChange={(v) => set({ duration_minutes: v })}
            />
          </StepShell>
        )}

        {step === 2 && (
          <StepShell icon={CalendarDays} title="Schedule (optional)">
            <Field
              label="Opens At"
              type="datetime-local"
              value={exam.scheduled_start}
              onChange={(v) => set({ scheduled_start: v })}
            />
            <Field
              label="Closes At"
              type="datetime-local"
              value={exam.scheduled_end}
              onChange={(v) => set({ scheduled_end: v })}
            />
            <p className="text-xs text-slate-400">
              Leave blank if this exam doesn't need a fixed window — students
              can join with the code any time once it's published.
            </p>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell icon={ShieldCheck} title="Security Requirements">
            <div className="space-y-2.5">
              {SECURITY_TOGGLES.map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={exam.security[t.key]}
                    onChange={() => setSecurity(t.key)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {t.label}
                    </p>
                    <p className="text-xs text-slate-400">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </StepShell>
        )}

        {step === 4 && (
          <StepShell icon={ListChecks} title="Questions">
            <div className="space-y-3">
              {exam.questions.length === 0 && (
                <p className="text-sm text-slate-400">
                  No questions yet. Add one below.
                </p>
              )}
              {exam.questions.map((q, i) => (
                <div
                  key={q.localId}
                  className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wide text-brand-600">
                      Q{i + 1} ·{" "}
                      {q.type === "mcq"
                        ? "Multiple Choice"
                        : q.type === "tf"
                          ? "True/False"
                          : "Short Answer"}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={q.marks}
                        onChange={(e) =>
                          updateQuestion(q.localId, { marks: e.target.value })
                        }
                        className="w-14 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <span className="text-[10px] text-slate-400">marks</span>
                      <button
                        onClick={() => removeQuestion(q.localId)}
                        className="text-slate-400 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <input
                    value={q.text}
                    onChange={(e) =>
                      updateQuestion(q.localId, { text: e.target.value })
                    }
                    placeholder="Question text…"
                    className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  {(q.type === "mcq" || q.type === "tf") && (
                    <div className="mt-2 space-y-1.5">
                      <p className="text-[10px] uppercase tracking-wide text-slate-400">
                        Select the correct answer
                      </p>
                      {q.options.map((opt, oi) => (
                        <label key={oi} className="flex items-center gap-2">
                          <input
                            type="radio"
                            checked={q.correctIndex === oi}
                            onChange={() =>
                              updateQuestion(q.localId, { correctIndex: oi })
                            }
                            className="h-3.5 w-3.5 text-brand-600"
                          />
                          {q.type === "mcq" ? (
                            <input
                              value={opt}
                              onChange={(e) => {
                                const options = [...q.options];
                                options[oi] = e.target.value;
                                updateQuestion(q.localId, { options });
                              }}
                              placeholder={`Option ${oi + 1}`}
                              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs focus:border-brand-500 focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                            />
                          ) : (
                            <span className="text-xs text-slate-600 dark:text-slate-300">
                              {opt}
                            </span>
                          )}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                icon={Plus}
                onClick={() => addQuestion("mcq")}
              >
                Multiple Choice
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={Plus}
                onClick={() => addQuestion("tf")}
              >
                True/False
              </Button>
              <Button
                size="sm"
                variant="outline"
                icon={Plus}
                onClick={() => addQuestion("short")}
              >
                Short Answer
              </Button>
            </div>
          </StepShell>
        )}

        {step === 5 && (
          <StepShell icon={FileCheck2} title="Review & Publish">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <ReviewRow label="Course" value={selectedCourse?.title} />
              <ReviewRow label="Title" value={exam.title} />
              <ReviewRow
                label="Duration"
                value={`${exam.duration_minutes} min`}
              />
              <ReviewRow
                label="Total Marks"
                value={exam.questions.reduce(
                  (sum, q) => sum + (Number(q.marks) || 0),
                  0,
                )}
              />
              <ReviewRow label="Questions" value={exam.questions.length} />
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {SECURITY_TOGGLES.filter((t) => exam.security[t.key]).map((t) => (
                <span
                  key={t.key}
                  className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                >
                  {t.label}
                </span>
              ))}
            </div>
            {error && (
              <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400">
                {error}
              </p>
            )}
          </StepShell>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between">
        <Button
          variant="ghost"
          icon={ArrowLeft}
          onClick={back}
          disabled={step === 0}
        >
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            iconRight={ArrowRight}
            onClick={next}
            disabled={!canProceed()}
          >
            Continue
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => save(false)}
            >
              {saving
                ? "Saving…"
                : isEditing
                  ? "Save Changes"
                  : "Save as Draft"}
            </Button>
            <Button disabled={saving} onClick={() => save(true)}>
              {saving
                ? "Publishing…"
                : isEditing
                  ? "Save & Publish"
                  : "Publish Exam"}
            </Button>
          </div>
        )}
      </div>

      <Modal
        open={!!result}
        onClose={() => navigate("/teacher/exams")}
        title={
          result?.status === "published"
            ? "Exam Published Successfully"
            : isEditing
              ? "Changes Saved"
              : "Exam Saved as Draft"
        }
      >
        <div className="text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            {result?.status === "published" ? (
              <PartyPopper className="h-6 w-6" />
            ) : (
              <CheckCircle2 className="h-6 w-6" />
            )}
          </span>
          <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
            {result?.status === "published"
              ? "Share this code with enrolled students so they can join."
              : "You can publish it later from the Exams page."}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-800">
            <span className="font-mono text-lg font-bold tracking-wide text-slate-900 dark:text-white">
              {result?.code}
            </span>
            <button
              onClick={() => navigator.clipboard?.writeText(result?.code || "")}
              className="text-slate-400 hover:text-brand-600"
            >
              <Copy className="h-4 w-4" />
            </button>
          </div>
          <Button
            className="mt-5 w-full"
            onClick={() => navigate("/teacher/exams")}
          >
            Go to Exams
          </Button>
        </div>
      </Modal>
    </main>
  );
}

function StepShell({ icon: Icon, title, children }) {
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
          <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
        </span>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">
          {title}
        </h2>
      </div>
      <div className="space-y-3.5">{children}</div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
      />
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-800">
      <p className="text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="font-semibold text-slate-800 dark:text-slate-100">
        {value || "—"}
      </p>
    </div>
  );
}
