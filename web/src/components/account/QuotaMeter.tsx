import { Progress } from '@/components/ui/progress'
import { formatBytes } from '@/lib/formatBytes'

/**
 * §7.8: the storage half of `QuotaService`'s two independent limits, made
 * visible. Shared between `Account.tsx` (where a user who needs to free
 * space is already standing) and `UploadDashboard.tsx` (where the limit is
 * about to bite) — put under `components/account/` because the quota is
 * an account-level resource (one number per user, not per speech); the
 * upload dashboard is a secondary consumer of the same fact, not its home.
 */
export function QuotaMeter({ usedBytes, quotaBytes }: { usedBytes: number; quotaBytes: number }) {
  // code-review finding: `quotaBytes > 0 ? ... : 0` rendered an empty,
  // reassuring-looking 0% bar for a user whose quota was set to 0 (fully
  // blocked) — misleading in exactly the one case the meter matters most.
  // A zero quota reads as "100% used, no room left," not "nothing to show."
  const percent = quotaBytes > 0 ? Math.min(100, (usedBytes / quotaBytes) * 100) : 100

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-sm text-muted-foreground">
        {formatBytes(usedBytes)} of {formatBytes(quotaBytes)} used
      </p>
      <Progress value={percent} aria-label="Storage used" />
    </div>
  )
}
