import { useEffect, useState } from "react";
import {
  X,
  Maximize2,
  GraduationCap,
  CalendarDays,
  BadgeCheck,
  Activity,
} from "lucide-react";
import Avatar from "./Avatar";
import StatusBadge from "./StatusBadge";
import AttentionBar from "./AttentionBar";
import LiveFeed from "./LiveFeed";
import SeverityTag from "./SeverityTag";
import { clockTime, timeAgo } from "../utils/format";

function identityText(identity) {
  if (!identity) return "—";
  switch (identity.status) {
    case "verified":
      return identity.similarity != null
        ? `Verified · ${Math.round(identity.similarity * 100)}%`
        : "Verified";
    case "mismatch":
      return identity.similarity != null
        ? `Mismatch · ${Math.round(identity.similarity * 100)}%`
        : "Mismatch";
    case "no_face":
      return "Face not visible";
    case "obstructed":
      return "Face covered";
    case "verifying":
      return "Verifying…";
    default:
      return identity.status || "—";
  }
}

export default function StudentDetailModal({
  student,
  onClose,
  alerts = [],
  frame = {},
}) {
  const [view, setView] = useState("face");
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    const onKey = (e) =>
      e.key === "Escape" && (fullscreen ? setFullscreen(false) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, fullscreen]);

  if (!student) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <Avatar name={student.name} size="lg" />
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                  {student.name}
                </h2>
                <StatusBadge
                  status={student.connected ? student.status : "offline"}
                />
              </div>
              <p className="font-mono text-xs text-slate-400">{student.id}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-5">
          {/* Left: live monitoring */}
          <div className="lg:col-span-3">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex gap-1 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {["face", "screen"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
                      view === v
                        ? "bg-white text-brand-700 shadow-sm dark:bg-slate-700 dark:text-brand-300"
                        : "text-slate-500"
                    }`}
                  >
                    {v} feed
                  </button>
                ))}
              </div>
              <button
                onClick={() => setFullscreen(true)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Maximize2 className="h-3.5 w-3.5" /> Fullscreen
              </button>
            </div>
            {frame?.[view === "face" ? "webcam" : "screen"] ? (
              <div className="relative h-72 w-full overflow-hidden rounded-lg bg-slate-900">
                <img
                  src={frame[view === "face" ? "webcam" : "screen"]}
                  alt=""
                  className="h-full w-full object-cover"
                />
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 backdrop-blur">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-white">
                    Live
                  </span>
                </div>
              </div>
            ) : (
              <LiveFeed
                type={view}
                seed={student.id + view}
                connected={student.connected}
                size="lg"
              />
            )}

            <div className="mt-3 grid grid-cols-3 gap-2">
              {Object.entries(student.confidence || {}).map(([k, v]) => (
                <div
                  key={k}
                  className="rounded-lg border border-slate-200 p-2 dark:border-slate-800"
                >
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    {k} conf.
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                    {Math.round(v * 100)}%
                  </p>
                </div>
              ))}
            </div>

            {(student.metrics?.brightness != null ||
              student.metrics?.blur != null) && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    Brightness (0-255)
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                    {student.metrics.brightness}
                  </p>
                </div>
                <div className="rounded-lg border border-slate-200 p-2 dark:border-slate-800">
                  <p className="text-[10px] uppercase tracking-wide text-slate-400">
                    Sharpness (blur var.)
                  </p>
                  <p className="text-sm font-bold tabular-nums text-slate-900 dark:text-white">
                    {student.metrics.blur}
                  </p>
                </div>
              </div>
            )}
          </div>
          {/* Right: info + timeline */}
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Student Info
              </h3>
              <dl className="space-y-1.5 text-xs">
                <Row
                  icon={GraduationCap}
                  label="Department"
                  value={student.department}
                />
                <Row
                  icon={BadgeCheck}
                  label="Identity"
                  value={identityText(student.identity)}
                />
                <Row
                  icon={Activity}
                  label="Faces / persons"
                  value={`${student.metrics?.faces ?? "—"} / ${student.metrics?.persons ?? "—"}`}
                />
                <Row
                  icon={Activity}
                  label="Objects in view"
                  value={
                    student.metrics?.objects?.length
                      ? student.metrics.objects
                          .map((o) => `${o.type.replace(" Detected", "")} (${Math.round(o.confidence * 100)}%)`)
                          .join(", ")
                      : "None"
                  }
                />
                <Row
                  icon={Activity}
                  label="Head / gaze"
                  value={`${student.metrics?.head ?? "—"} / ${student.metrics?.gaze ?? "—"}`}
                />
                <Row
                  icon={Activity}
                  label="Last active"
                  value={timeAgo(student.lastActivity)}
                />
              </dl>
              <div className="mt-3">
                <AttentionBar score={student.attention} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Event Timeline · {alerts.length}
              </h3>
              <div className="max-h-56 space-y-2 overflow-y-auto">
                {alerts.length === 0 && (
                  <p className="text-xs text-slate-400">No events recorded.</p>
                )}
                {alerts.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-2 border-l-2 border-slate-200 pl-2 dark:border-slate-700"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <p className="truncate text-[11px] font-medium text-slate-700 dark:text-slate-200">
                          {a.type}
                        </p>
                        <SeverityTag severity={a.severity} />
                      </div>
                      <p className="font-mono text-[10px] text-slate-400">
                        {clockTime(a.timestamp)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen feed */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black p-6"
          onClick={() => setFullscreen(false)}
        >
          <div
            className="w-full max-w-5xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between text-white">
              <span className="text-sm font-medium">
                {student.name} — {view} feed
              </span>
              <button onClick={() => setFullscreen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <LiveFeed
              type={view}
              seed={student.id + view}
              connected={student.connected}
              size="lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
        <Icon className="h-3.5 w-3.5" /> {label}
      </dt>
      <dd className="ml-2 max-w-[60%] truncate text-right font-medium text-slate-900 dark:text-white" title={typeof value === "string" ? value : undefined}>{value}</dd>
    </div>
  );
}