import { auditActor, auditDetails, auditSentence } from '@/lib/audit';
import { formatDateTime, relativeTime } from '@/lib/dates';
import { BusinessBadge } from '@/components/business-badge';
import type { AuditEntry } from '@/server/queries/audit';
import type { BusinessLite } from '@/server/context';

/** Human-readable history: what happened, who did it, when (and what changed). */
export function AuditList({ rows, tz, businesses, showBusiness }: { rows: AuditEntry[]; tz: string; businesses: BusinessLite[]; showBusiness?: boolean }) {
  return (
    <ol className="divide-y divide-border">
      {rows.map((r) => {
        const details = auditDetails(r);
        return (
          <li key={r.id} className="flex gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm">{auditSentence(r)}</p>
              {details.length ? (
                <ul className="mt-1 space-y-0.5 text-xs text-muted">{details.slice(0, 6).map((d) => <li key={d} className="truncate">{d}</li>)}</ul>
              ) : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                <span className="font-medium text-text/80">{auditActor(r)}</span>
                <span title={formatDateTime(r.createdAt, tz)}>{relativeTime(r.createdAt)}</span>
                {r.ip ? <span>· {r.ip}</span> : null}
                {showBusiness && r.subAccountId ? <BusinessBadge business={businesses.find((b) => b.id === r.subAccountId)} /> : null}
                {showBusiness && !r.subAccountId ? <span>· Account</span> : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
