import { AlertTriangle, CheckCircle2, Clock, CircleSlash, Loader2, ShieldAlert } from 'lucide-react';

interface StatusTextProps {
  status: string;
  label?: string;
}

export function StatusText({ status, label }: StatusTextProps) {
  const s = status.toLowerCase();
  const display =
    label ||
    status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());

  if (
    s === 'connected' ||
    s === 'completed' ||
    s === 'active' ||
    s === 'operational' ||
    s === 'ready' ||
    s === 'success' ||
    s === 'sent' ||
    s === 'product_deployed' ||
    s === 'business_operational'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (
    s === 'awaiting_approval' ||
    s === 'clarification_needed' ||
    s === 'configured_untested' ||
    s === 'paused' ||
    s === 'degraded' ||
    s === 'partial' ||
    s === 'warn'
  ) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 whitespace-nowrap">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (s === 'error' || s === 'failed' || s === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-400 whitespace-nowrap">
        <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (s === 'analyzing' || s === 'running' || s === 'in_progress' || s === 'waiting_ai' || s === 'planning') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-400 whitespace-nowrap">
        <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  if (s === 'disabled' || s === 'archived' || s === 'cancelled' || s === 'not_configured' || s === 'skipped') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 whitespace-nowrap">
        <CircleSlash className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>{display}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap">
      <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}
