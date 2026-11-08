import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import {
  BookOpen,
  Info,
  CalendarDays,
  ShieldCheck,
  ListChecks,
  FileCheck2,
  Plus,
  ArrowLeft,
  ArrowRight,
  Copy,
  PartyPopper,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Lock,
  ArrowUp,
  ArrowDown,
  Trash2,
  Eye,
} from "lucide-react";
import { useExams } from "../../context/ExamContext";
import { useNotify } from "../../context/NotifyContext";
import { api } from "../../services/api";
import { Stepper } from "../../components/common/ProgressBar";
import Button from "../../components/common/Button";
import Modal from "../../components/common/Modal";
import { docPlainText } from "../../components/answer-editor/schema";
import QuestionEditor, { QuestionPreview } from "../../components/questions/QuestionEditor";
import { DatePicker, TimePicker } from "../../components/common/DateTimePickers";
import {
  browserTimeZone,
  listTimeZones,
  zonedToUtcMs,
  utcMsToZoned,
  formatInZone,
  formatUtc,
} from "../../utils/examTime";
import {
  QUESTION_TYPES,
  blankQuestion,
  questionFromApi,
  questionToPayload,
  validateQuestion,
  syncPlaceholders,
  typeLabel,
} from "../../components/questions/questionTypes";

const STEPS = [
  "Course",
  "Basic Info",
  "Schedule",
  "Tools",
  "Questions",
  "Review",
];

// The proctoring checks (camera, microphone, screen share, identity, liveness) are
// always enforced by the backend and are not shown here. The calculator is the
// only tool the teacher can choose to allow.
const TOOLS = [
  {
    key: "calculator",
    label: "Allow Scientific Calculator",
    desc: "Students can open the built-in scientific calculator during the exam.",
  },
];

const DEFAULT_SECURITY = {
  camera: true,
  microphone: true,
  screenShare: true,
  identity: true,
  liveness: true,
  calculator: true,
};

const blankExam = () => ({
  courseId: null,
  title: "",
  description: "",
  duration_minutes: 60,
  // Opening time is entered as date + time + an explicit time zone; the closing
  // time is derived (opening + duration) and never typed.
  start_date: "",
  start_time: "",
  tz: browserTimeZone(),
  security: { ...DEFAULT_SECURITY },
  questions: [],
});

const TIME_ZONES = listTimeZones();

export default function CreateExam() {
  const { courses, createExam, updateExam, publishExam } = useExams();
  const navigate = useNavigate();
  const notify = useNotify();
  const [searchParams] = useSearchParams();
  const editId = searchParams.get("edit");
  const isEditing = !!editId;

  const [step, setStep] = useState(0);
  const [previewAllOpen, setPreviewAllOpen] = useState(false);
  const [exam, setExam] = useState(blankExam());
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);
  const [showErrors, setShowErrors] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);
  const [examStatus, setExamStatus] = useState("draft");
  const [questionsLocked, setQuestionsLocked] = useState(false);
  const activeCardRef = useRef(null);

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
        setExamStatus(e.status);
        setQuestionsLocked(!!e.has_attempts);
        const tz = browserTimeZone();
        const startMs = e.scheduled_start ? new Date(e.scheduled_start).getTime() : null;
        const zoned = utcMsToZoned(startMs, tz);
        setExam({
          courseId: e.course_id,
          title: e.title,
          description: e.description,
          duration_minutes: e.duration_minutes,
          start_date: zoned.date,
          start_time: zoned.time,
          tz,
          security: { ...DEFAULT_SECURITY, calculator: e.security?.calculator !== false },
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

  // Authoritative UTC clock from the server, so a wrong PC clock can't let a
  // teacher schedule an exam in the past (or block a valid time).
  const [clockOffset, setClockOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const t0 = Date.now();
    api
      .get("/time")
      .then((r) => {
        const server = new Date(r.utc).getTime();
        if (!cancelled && !Number.isNaN(server)) setClockOffset(server - (t0 + Date.now()) / 2);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const serverNow = () => Date.now() + clockOffset;

  const focusActiveCard = () => {
    requestAnimationFrame(() => {
      activeCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const addQuestion = (type) => {
    const q = blankQuestion(type);
    setExam((e) => ({ ...e, questions: [...e.questions, q] }));
    setActiveId(q.localId);
    setPickerOpen(false);
    focusActiveCard();
  };

  const openQuestion = (id) => {
    setActiveId(id);
    focusActiveCard();
  };
  const updateQuestion = (id, patch) =>
    setExam((e) => ({
      ...e,
      questions: e.questions.map((q) => {
        if (q.localId !== id) return q;
        const next = { ...q, ...patch };
        return "text" in patch ? syncPlaceholders(next) : next;
      }),
    }));
  const removeQuestion = (id) => {
    setExam((e) => ({
      ...e,
      questions: e.questions.filter((q) => q.localId !== id),
    }));
    setActiveId((current) => (current === id ? null : current));
  };
  const moveQuestion = (index, delta) =>
    setExam((e) => {
      const target = index + delta;
      if (target < 0 || target >= e.questions.length) return e;
      const questions = [...e.questions];
      [questions[index], questions[target]] = [questions[target], questions[index]];
      return { ...e, questions };
    });

  const questionErrors = Object.fromEntries(
    exam.questions.map((q) => [q.localId, validateQuestion(q)]),
  );
  const invalidCount = Object.values(questionErrors).filter(Boolean).length;
  const answerableCount = exam.questions.filter(
    (q) => q.type !== "text_block",
  ).length;

  const durationError = (() => {
    const d = exam.duration_minutes;
    if (d === "" || d === null || d === undefined) return "Enter the exam duration.";
    const n = Number(d);
    if (!Number.isInteger(n)) return "Duration must be a whole number of minutes.";
    if (n < 1) return "Duration must be at least 1 minute.";
    if (n > 600) return "Duration cannot be more than 600 minutes (10 hours).";
    return null;
  })();
  const titleError = exam.title.trim().length < 2 ? "Title must be at least 2 characters." : null;
  const hasSchedule = !!(exam.start_date || exam.start_time);
  const startMs = zonedToUtcMs(exam.start_date, exam.start_time, exam.tz);
  const endMs =
    startMs != null && !durationError ? startMs + Number(exam.duration_minutes) * 60000 : null;
  const scheduleError = !hasSchedule
    ? null
    : !exam.start_date || !exam.start_time
      ? "Choose both a start date and a start time."
      : startMs == null
        ? "That date or time is not valid."
        : !isEditing && startMs < serverNow() - 60000
          ? "The start time is in the past. Choose a future date and time."
          : null;

  const canProceed = () => {
    if (step === 0) return !!exam.courseId;
    if (step === 1) return !titleError && !durationError;
    if (step === 2) return !scheduleError;
    if (step === 4) return questionsLocked || answerableCount > 0;
    return true;
  };

  const next = () => {
    if (step === 4 && !questionsLocked && invalidCount > 0) {
      setShowErrors(true);
      const firstInvalid = exam.questions.find((q) => questionErrors[q.localId]);
      if (firstInvalid) openQuestion(firstInvalid.localId);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const buildPayload = () => ({
    course_id: exam.courseId,
    title: exam.title,
    description: exam.description,
    duration_minutes: Number(exam.duration_minutes),
    // Sent as UTC instants; the server re-derives the closing time itself.
    scheduled_start: startMs != null ? new Date(startMs).toISOString() : null,
    scheduled_end: endMs != null ? new Date(endMs).toISOString() : null,
    // Proctoring checks are always on (the server enforces this); only the calculator is optional.
    security: { ...DEFAULT_SECURITY, calculator: !!exam.security.calculator },
    questions: questionsLocked ? null : exam.questions.map(questionToPayload),
  });

  const save = async (publish) => {
    setSaving(true);
    try {
      const saved = isEditing
        ? await updateExam(editId, buildPayload())
        : await createExam(buildPayload());
      if (publish && saved.status === "draft") {
        const published = await publishExam(saved.id);
        setResult(published);
        notify.success("Exam published successfully.");
      } else {
        setResult(saved);
        notify.success(isEditing ? "Exam updated successfully." : "Exam saved as draft.");
      }
    } catch (e) {
      notify.error(e.message || "Could not save the exam");
    } finally {
      setSaving(false);
    }
  };

  const selectedCourse = courses.find((c) => c.id === exam.courseId);
  const activeIndex = exam.questions.findIndex((q) => q.localId === activeId);
  const activeQuestion = activeIndex >= 0 ? exam.questions[activeIndex] : null;
  const typeCounts = exam.questions.reduce((acc, q) => {
    acc[q.type] = (acc[q.type] || 0) + 1;
    return acc;
  }, {});

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
    <main className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">
        {isEditing ? "Edit Exam" : "Create Exam"}
      </h1>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
        {isEditing
          ? questionsLocked
            ? "Students have started this exam — you can edit its details, schedule and tools. Questions are locked."
            : "Update the details, schedule, tools, or questions for this exam."
          : "Build out the course, schedule, tools, and questions."}
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
              maxLength={160}
              error={exam.title.length > 0 ? titleError : null}
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
              min={1}
              max={600}
              step={1}
              value={exam.duration_minutes}
              onChange={(v) => set({ duration_minutes: v })}
              error={durationError}
            />
          </StepShell>
        )}

        {step === 2 && (
          <StepShell icon={CalendarDays} title="Schedule (optional)">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <DatePicker
                label="Start date"
                value={exam.start_date}
                onChange={(v) => set({ start_date: v })}
                min={isEditing ? undefined : utcMsToZoned(serverNow(), exam.tz).date}
                error={scheduleError}
              />
              <TimePicker
                label="Start time"
                value={exam.start_time}
                onChange={(v) => set({ start_time: v })}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Time zone
              </label>
              <select
                value={exam.tz}
                onChange={(e) => set({ tz: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                {(TIME_ZONES.includes(exam.tz) ? TIME_ZONES : [exam.tz, ...TIME_ZONES]).map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-400">
                The time above is read in this zone and stored as UTC, so every student sees the same moment in their own local time.
              </p>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                Closes at (calculated)
              </label>
              <div
                aria-readonly="true"
                className="w-full cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-2.5 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300"
              >
                {endMs != null ? formatInZone(endMs, exam.tz) : "Set a start date and time to see when the exam closes"}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Start time + {exam.duration_minutes || 0}-minute duration.
              </p>
            </div>

            {startMs != null && !scheduleError && (
              <div className="rounded-lg border border-brand-200 bg-brand-50/60 p-3 text-xs text-slate-600 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-slate-300">
                <p><span className="font-semibold">Opens:</span> {formatInZone(startMs, exam.tz)} · {formatUtc(startMs)}</p>
                <p className="mt-0.5"><span className="font-semibold">Closes:</span> {formatInZone(endMs, exam.tz)} · {formatUtc(endMs)}</p>
              </div>
            )}

            {hasSchedule && (
              <button
                type="button"
                onClick={() => set({ start_date: "", start_time: "" })}
                className="text-xs font-semibold text-slate-500 hover:text-brand-600"
              >
                Clear schedule
              </button>
            )}
            <p className="text-xs text-slate-400">
              Optional. Leave blank if this exam doesn't need a fixed window — students
              can join with the code any time once it's published.
            </p>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell icon={ShieldCheck} title="Tools">
            <div className="space-y-2.5">
              {TOOLS.map((t) => (
                <label
                  key={t.key}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={!!exam.security[t.key]}
                    onChange={() =>
                      setExam((e) => ({ ...e, security: { ...e.security, [t.key]: !e.security[t.key] } }))
                    }
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.label}</p>
                    <p className="text-xs text-slate-400">{t.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </StepShell>
        )}

        {step === 4 && (
          <StepShell icon={ListChecks} title="Questions">
            {questionsLocked ? (
              <div className="space-y-3" data-testid="questions-locked">
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                  <Lock className="mt-0.5 h-4 w-4 shrink-0" />
                  Students have already started this exam, so its questions are locked to keep their answers and grades valid.
                  You can still change the title, description, schedule, duration and tools.
                </p>
                <QuestionList
                  questions={exam.questions}
                  errors={{}}
                  readOnly
                />
              </div>
            ) : (
              <>
                {showErrors && invalidCount > 0 && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-400" role="alert">
                    <AlertCircle className="h-4 w-4" />
                    Fix {invalidCount} question{invalidCount > 1 ? "s" : ""} before continuing — they are marked in red below.
                  </p>
                )}

                <div>
                  <Button
                    size="sm"
                    icon={Plus}
                    data-testid="add-question"
                    onClick={() => setPickerOpen((o) => !o)}
                  >
                    {pickerOpen ? "Close" : "Add Question"}
                  </Button>
                  {pickerOpen && (
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {QUESTION_TYPES.map((t) => (
                        <button
                          key={t.type}
                          type="button"
                          data-testid={`add-type-${t.type}`}
                          onClick={() => addQuestion(t.type)}
                          className="rounded-lg border border-slate-200 p-2.5 text-left hover:border-brand-400 hover:bg-brand-50/50 dark:border-slate-700 dark:hover:bg-brand-500/10"
                        >
                          <span className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                              {t.label}
                            </span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                t.type === "text_block"
                                  ? "bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400"
                                  : t.auto
                                    ? "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400"
                                    : "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400"
                              }`}
                            >
                              {t.type === "text_block" ? "Info" : t.auto ? "Auto" : "Manual"}
                            </span>
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-400">{t.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div ref={activeCardRef} className="scroll-mt-4">
                  {activeIndex >= 0 ? (
                    <div className="rounded-xl border-2 border-brand-300 bg-brand-50/30 p-1 dark:border-brand-500/40 dark:bg-brand-500/5" data-testid="active-question">
                      <div className="flex items-center justify-between px-2 py-1">
                        <span className="text-[11px] font-bold uppercase tracking-wide text-brand-700 dark:text-brand-300">
                          Editing question {activeIndex + 1} of {exam.questions.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveId(null)}
                          className="text-[11px] font-semibold text-slate-500 hover:text-brand-600"
                        >
                          Done
                        </button>
                      </div>
                      <div className="rounded-lg bg-white dark:bg-slate-900">
                        <QuestionEditor
                          key={activeQuestion.localId}
                          q={activeQuestion}
                          index={activeIndex}
                          total={exam.questions.length}
                          onChange={(patch) => updateQuestion(activeQuestion.localId, patch)}
                          onRemove={() => removeQuestion(activeQuestion.localId)}
                          onMove={(delta) => moveQuestion(activeIndex, delta)}
                          error={showErrors ? questionErrors[activeQuestion.localId] : null}
                        />
                      </div>
                    </div>
                  ) : (
                    exam.questions.length > 0 && (
                      <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-center text-xs text-slate-400 dark:border-slate-700">
                        Select a question below to edit it, or add a new one.
                      </p>
                    )
                  )}
                </div>

                {exam.questions.length === 0 ? (
                  <p className="text-sm text-slate-400">No questions yet. Click “Add Question” to create the first one.</p>
                ) : (
                  <QuestionList
                    questions={exam.questions}
                    errors={showErrors ? questionErrors : {}}
                    activeId={activeId}
                    onOpen={openQuestion}
                    onMove={moveQuestion}
                    onRemove={removeQuestion}
                  />
                )}
              </>
            )}
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
                value={exam.questions
                  .filter((q) => q.type !== "text_block")
                  .reduce((sum, q) => sum + (Math.round(Number(q.marks)) || 0), 0)}
              />
              <ReviewRow label="Questions" value={answerableCount} />
              <ReviewRow
                label="Opens"
                value={startMs != null ? `${formatInZone(startMs, exam.tz)} (${formatUtc(startMs)})` : "Anytime once published"}
              />
              <ReviewRow
                label="Closes"
                value={endMs != null ? `${formatInZone(endMs, exam.tz)} (${formatUtc(endMs)})` : "—"}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {Object.entries(typeCounts).map(([type, count]) => (
                <span
                  key={type}
                  className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                >
                  {typeLabel(type)} × {count}
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {TOOLS.filter((t) => exam.security[t.key]).map((t) => (
                <span
                  key={t.key}
                  className="rounded-full bg-brand-50 px-2.5 py-1 text-[11px] font-medium text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                >
                  {t.label}
                </span>
              ))}
            </div>
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
          <div className="flex items-center gap-2">
            {step === 4 && exam.questions.length > 0 && (
              <Button
                variant="outline"
                icon={Eye}
                data-testid="preview-all-questions"
                onClick={() => setPreviewAllOpen(true)}
              >
                Preview all questions
              </Button>
            )}
            <Button
              iconRight={ArrowRight}
              onClick={next}
              disabled={!canProceed()}
            >
              Continue
            </Button>
          </div>
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
            {(!isEditing || examStatus === "draft") && (
            <Button disabled={saving} onClick={() => save(true)}>
              {saving
                ? "Publishing…"
                : isEditing
                  ? "Save & Publish"
                  : "Publish Exam"}
            </Button>
            )}
          </div>
        )}
      </div>

      <Modal
        open={previewAllOpen}
        onClose={() => setPreviewAllOpen(false)}
        title={`Preview all questions (${exam.questions.length})`}
        maxWidth="max-w-3xl"
        footer={<Button onClick={() => setPreviewAllOpen(false)}>Close preview</Button>}
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1" data-testid="preview-all-modal">
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            This is exactly how students will see the exam. Close this window to keep editing.
          </p>
          {exam.questions.map((q, i) => {
            const err = questionErrors[q.localId];
            return (
              <section
                key={q.localId}
                className={`rounded-xl border p-4 ${err ? "border-rose-300 dark:border-rose-500/40" : "border-slate-200 dark:border-slate-700"}`}
              >
                <header className="mb-3 flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold uppercase tracking-wide text-brand-600">
                    Question {i + 1} · {typeLabel(q.type)}
                  </span>
                  {q.type !== "text_block" && (
                    <span className="font-semibold text-slate-500">{q.marks || 0} marks</span>
                  )}
                </header>
                <QuestionPreview q={q} />
                {err && (
                  <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-rose-600">
                    <AlertCircle className="h-3.5 w-3.5" /> Needs attention: {err}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => { setPreviewAllOpen(false); openQuestion(q.localId); }}
                  className="mt-2 text-[11px] font-semibold text-brand-600 hover:underline"
                >
                  Edit this question
                </button>
              </section>
            );
          })}
        </div>
      </Modal>

      <Modal
        open={!!result}
        onClose={() => navigate("/teacher/exams")}
        title={
          isEditing && examStatus !== "draft"
            ? "Changes Saved"
            : result?.status === "published"
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

function QuestionList({ questions, errors, activeId, onOpen, onMove, onRemove, readOnly = false }) {
  return (
    <div className="mt-4" data-testid="question-list">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        All questions ({questions.length}) · in exam order
      </p>
      <ol className="space-y-1.5">
        {questions.map((q, i) => {
          const err = errors[q.localId];
          const active = q.localId === activeId;
          return (
            <li
              key={q.localId}
              data-testid="question-row"
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                active
                  ? "border-brand-400 bg-brand-50/60 dark:bg-brand-500/10"
                  : err
                    ? "border-rose-300 bg-rose-50/50 dark:border-rose-500/40 dark:bg-rose-500/5"
                    : "border-slate-200 dark:border-slate-700"
              }`}
            >
              <span className="w-7 shrink-0 font-bold text-slate-500">Q{i + 1}</span>
              <button
                type="button"
                disabled={readOnly}
                onClick={() => onOpen?.(q.localId)}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <span className="block truncate font-medium text-slate-800 dark:text-slate-100">
                  {q.text.trim() || (q.richContent && docPlainText(q.richContent).trim() ? docPlainText(q.richContent).trim() : q.richContent ? <span className="italic text-slate-500">Question with table, diagram or equation</span> : <span className="italic text-slate-400">Untitled question</span>)}
                </span>
                <span className="text-[11px] text-slate-400">
                  {typeLabel(q.type)}
                  {q.type !== "text_block" ? ` · ${q.marks || 0} marks` : ""}
                  {q.richContent ? " · has tables/diagrams" : ""}
                  {q.media?.length ? ` · ${q.media.length} image${q.media.length > 1 ? "s" : ""}` : ""}
                </span>
                {err && <span className="block text-[11px] font-medium text-rose-600">{err}</span>}
              </button>
              {!readOnly && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button type="button" onClick={() => onOpen?.(q.localId)} className="rounded px-2 py-1 font-semibold text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10">
                    {active ? "Editing" : "Edit"}
                  </button>
                  <button type="button" title="Move up" aria-label={`Move question ${i + 1} up`} disabled={i === 0} onClick={() => onMove?.(i, -1)} className="rounded p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title="Move down" aria-label={`Move question ${i + 1} down`} disabled={i === questions.length - 1} onClick={() => onMove?.(i, 1)} className="rounded p-1 text-slate-400 hover:text-brand-600 disabled:opacity-30">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title="Delete" aria-label={`Delete question ${i + 1}`} onClick={() => onRemove?.(q.localId)} className="rounded p-1 text-slate-400 hover:text-rose-600">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
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

function Field({ label, value, onChange, type = "text", placeholder, error, ...rest }) {
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
        aria-invalid={!!error}
        {...rest}
        className={`w-full rounded-lg border bg-slate-50 px-3 py-2.5 text-sm focus:border-brand-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:bg-slate-800 dark:text-white ${
          error ? "border-rose-400 ring-1 ring-rose-300" : "border-slate-200 dark:border-slate-700"
        }`}
      />
      {error && <p className="mt-1 text-[11px] font-medium text-rose-600" role="alert">{error}</p>}
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
        {value ?? "—"}
      </p>
    </div>
  );
}