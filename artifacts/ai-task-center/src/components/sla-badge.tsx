import { Clock, AlertTriangle, CheckCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id } from "date-fns/locale";

interface SlaBadgeProps {
  slaStatus: string;
  overdueAt?: string | null;
  completedAt?: string | null;
  slaHours?: number | null;
  showCountdown?: boolean;
}

const SLA_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ElementType }> = {
  on_track:  { label: "On Track",  color: "text-green-700",  bg: "bg-green-50",   border: "border-green-200", icon: CheckCircle },
  due_soon:  { label: "Due Soon",  color: "text-amber-700",  bg: "bg-amber-50",   border: "border-amber-200", icon: Clock },
  overdue:   { label: "Overdue",   color: "text-red-700",    bg: "bg-red-50",     border: "border-red-200",   icon: AlertTriangle },
  completed: { label: "Selesai",   color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-200",  icon: CheckCircle },
};

const EMOJI: Record<string, string> = { on_track: "🟢", due_soon: "🟡", overdue: "🔴", completed: "✅" };

export function SlaBadge({ slaStatus, overdueAt, completedAt, slaHours, showCountdown = true }: SlaBadgeProps) {
  const cfg = SLA_CONFIG[slaStatus] ?? SLA_CONFIG.on_track;
  const Icon = cfg.icon;

  const countdown = (() => {
    if (!showCountdown) return null;
    if (completedAt) return null;
    if (!overdueAt) return null;
    const now = new Date();
    const due = new Date(overdueAt);
    if (slaStatus === "overdue") {
      return `Terlambat ${formatDistanceToNow(due, { locale: id })}`;
    }
    return `Sisa ${formatDistanceToNow(due, { addSuffix: false, locale: id })}`;
  })();

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
      <Icon className="h-3 w-3" />
      <span>{EMOJI[slaStatus]} {cfg.label}</span>
      {countdown && <span className="opacity-75">— {countdown}</span>}
      {slaHours && !completedAt && <span className="opacity-60">/ SLA {slaHours}j</span>}
    </span>
  );
}
