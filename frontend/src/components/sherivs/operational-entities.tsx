import { cn } from "@/lib/utils";
import {
  ShieldCheck,
  Cpu,
  Clock,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  Key,
} from "lucide-react";
import { CognitivePill, ConfidenceMeter } from "./brand";

export interface EvidenceCardProps {
  hash: string;
  source: string;
  timestamp: string;
  confidence: number;
  validator: string;
  verified: boolean;
  className?: string;
}

export function EvidenceCard({
  hash,
  source,
  timestamp,
  confidence,
  validator,
  verified,
  className,
}: EvidenceCardProps) {
  return (
    <div className={cn("sherivs-card p-4 space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CognitivePill type="evidence" label="Cryptographic Evidence" />
          {verified ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400">
              <ShieldCheck className="size-3.5" />
              Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-400">
              <AlertCircle className="size-3.5" />
              Pending Sign-off
            </span>
          )}
        </div>
        <ConfidenceMeter confidence={confidence} />
      </div>

      <div className="space-y-1.5 font-mono text-xs">
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Source:</span>
          <span className="text-foreground">{source}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Validator:</span>
          <span className="text-foreground">{validator}</span>
        </div>
        <div className="flex items-center justify-between text-muted-foreground">
          <span>Timestamp:</span>
          <span className="text-foreground">{timestamp}</span>
        </div>
      </div>

      <div className="pt-2 border-t border-border flex items-center justify-between gap-2 font-mono text-[11px]">
        <span className="text-muted-foreground truncate">SHA-256:</span>
        <code className="text-cyan-400 truncate max-w-[200px] sm:max-w-xs">{hash}</code>
      </div>
    </div>
  );
}

export interface MissionCardProps {
  missionId: string;
  title: string;
  owner: string;
  status: "planning" | "executing" | "verifying" | "completed" | "quarantined";
  workers: string[];
  evidenceCount: number;
  progressPercent: number;
  className?: string;
  onClick?: () => void;
}

export function MissionCard({
  missionId,
  title,
  owner,
  status,
  workers,
  evidenceCount,
  progressPercent,
  className,
  onClick,
}: MissionCardProps) {
  const statusStyles = {
    planning: "bg-blue-500/10 text-blue-400 border-blue-500/25",
    executing: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30 animate-pulse",
    verifying: "bg-violet-500/10 text-violet-400 border-violet-500/25",
    completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
    quarantined: "bg-rose-500/10 text-rose-400 border-rose-500/25",
  };

  return (
    <div
      onClick={onClick}
      className={cn(
        "sherivs-card p-5 space-y-4 cursor-pointer hover:border-cyan-500/40 hover:scale-[1.01] transition-all",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground font-semibold">{missionId}</span>
            <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-bold border", statusStyles[status])}>
              {status}
            </span>
          </div>
          <h3 className="font-display font-semibold text-base text-foreground truncate">{title}</h3>
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Execution Progress</span>
          <span className="font-mono font-medium">{progressPercent}%</span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn("h-full transition-all duration-300", status === "completed" ? "bg-emerald-500" : "bg-cyan-500")}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Metadata */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <User className="size-3.5" />
          <span>{owner}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 font-mono text-[11px]">
            <Cpu className="size-3.5 text-cyan-400" />
            {workers.length} Workers
          </span>
          <span className="flex items-center gap-1 font-mono text-[11px]">
            <FileText className="size-3.5 text-emerald-400" />
            {evidenceCount} Evidence
          </span>
        </div>
      </div>
    </div>
  );
}

export interface WorkerCardProps {
  workerId: string;
  name: string;
  model: string;
  authorityLevel: "L1-Standard" | "L2-Supervised" | "L3-Restricted" | "L4-Critical";
  activeMissionsCount: number;
  reliabilityScore: number;
  leaseExpiresIn: string;
  className?: string;
}

export function WorkerCard({
  workerId,
  name,
  model,
  authorityLevel,
  activeMissionsCount,
  reliabilityScore,
  leaseExpiresIn,
  className,
}: WorkerCardProps) {
  return (
    <div className={cn("sherivs-card p-5 space-y-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 font-bold">
            <Cpu className="size-5" />
          </div>
          <div>
            <h4 className="font-display font-bold text-foreground text-sm">{name}</h4>
            <p className="font-mono text-xs text-muted-foreground">{workerId}</p>
          </div>
        </div>
        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium border bg-muted/50 border-border">
          {authorityLevel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
        <div className="space-y-0.5">
          <span className="text-muted-foreground text-[11px]">Underlying Model</span>
          <p className="font-mono text-foreground font-medium truncate">{model}</p>
        </div>
        <div className="space-y-0.5">
          <span className="text-muted-foreground text-[11px]">Active Lease</span>
          <p className="font-mono text-foreground font-medium">{leaseExpiresIn}</p>
        </div>
      </div>

      <div className="pt-3 border-t border-border flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Reliability:</span>
        <ConfidenceMeter confidence={reliabilityScore} />
      </div>
    </div>
  );
}

export interface RealityNodeCardProps {
  nodeId: string;
  name: string;
  kind: "person" | "room" | "device" | "organization" | "event";
  state: string;
  relationshipsCount: number;
  lastObserved: string;
  className?: string;
}

export function RealityNodeCard({
  nodeId,
  name,
  kind,
  state,
  relationshipsCount,
  lastObserved,
  className,
}: RealityNodeCardProps) {
  return (
    <div className={cn("sherivs-card p-4 space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase bg-muted/60 text-muted-foreground border border-border">
          {kind}
        </span>
        <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {state}
        </span>
      </div>
      <div>
        <h4 className="font-display font-semibold text-sm text-foreground truncate">{name}</h4>
        <p className="font-mono text-xs text-muted-foreground truncate">{nodeId}</p>
      </div>
      <div className="pt-2 border-t border-border flex items-center justify-between text-xs text-muted-foreground font-mono">
        <span>Edges: {relationshipsCount}</span>
        <span>Observed: {lastObserved}</span>
      </div>
    </div>
  );
}
