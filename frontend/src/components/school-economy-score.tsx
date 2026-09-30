import { useSchoolEconomyScore } from "@/hooks/use-school-economy-score";

function ScoreGauge({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (circumference * Math.min(score, 100)) / 100;
  const color = score >= 80 ? "#10b981" : score >= 60 ? "#f59e0b" : "#ef4444";

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth="12"
        />
        <circle
          cx="70"
          cy="70"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold" style={{ color }}>
          {score}
        </span>
        <span className="text-[10px] text-white/40 uppercase tracking-widest mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

export function SchoolEconomyScore({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useSchoolEconomyScore();

  if (isLoading) {
    return (
      <div className="enterprise-card p-6 animate-pulse">
        <div className="h-4 w-40 bg-white/10 rounded mb-4" />
        <div className="h-36 w-36 rounded-full bg-white/10 mx-auto" />
      </div>
    );
  }

  if (!data) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-2xl font-bold text-white">{data.overall}</span>
        <div>
          <div className="text-xs text-white/40">Economy Score</div>
          <div
            className={`text-xs font-semibold ${
              data.overall >= 80
                ? "text-emerald-400"
                : data.overall >= 60
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            Grade {data.grade}
          </div>
        </div>
      </div>
    );
  }

  const components = [
    data.feeCollection,
    data.studentAttendance,
    data.teacherAttendance,
    data.enrollment,
    data.academic,
  ];

  return (
    <div className="enterprise-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-sm font-semibold text-white/80">School Economy Score</h3>
          <p className="text-xs text-white/40 mt-0.5">Composite institutional health index</p>
        </div>
        <span
          className={`status-badge text-sm px-3 py-1 ${
            data.grade === "A"
              ? "status-success"
              : data.grade === "B"
                ? "status-info"
                : data.grade === "C"
                  ? "status-warning"
                  : "status-danger"
          }`}
        >
          Grade {data.grade}
        </span>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-8">
        <ScoreGauge score={data.overall} />

        <div className="flex-1 w-full space-y-3">
          {components.map((c) => (
            <div key={c.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-white/60">{c.label}</span>
                <span className="text-white/80 font-medium">{c.rate.toFixed(0)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(c.rate, 100)}%`,
                    background: c.rate >= 80 ? "#10b981" : c.rate >= 60 ? "#f59e0b" : "#ef4444",
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
