import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ExportSection } from '@/components/account/ExportSection'
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog'
import { useExportJob, latestExportOfKind } from '@/hooks/useExportJob'

/**
 * STEP-11-FROZEN-CONTRACT.md §10: a new `/account` route, nested in
 * `App.tsx`'s existing `RequireAuth`+`RequireVerified`+`AppLayout` group —
 * not bolted onto `ProfileEdit.tsx` ("this is higher-stakes and deserves
 * its own screen," per the frontend agent's recommendation the contract
 * cites).
 *
 * Two sections, per STEP-11.md's frontend requirements: export (both
 * `kind`s — "your speeches and the commentary written about you" for
 * `'account'`, the reviewer "download my annotations" mitigation for
 * `'reviewer_annotations'`) and account deletion.
 */
export default function Account() {
  const { exports } = useExportJob()

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>Request a copy of your data as a file you can download and open.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <ExportSection
            kind="account"
            title="Everything on your speeches"
            description="Every speech you own, plus every review on it — reviewer identity, published essays and published annotations."
            latest={latestExportOfKind(exports, 'account')}
          />
          <ExportSection
            kind="reviewer_annotations"
            title="Your annotations as a reviewer"
            description="Every review where you're the reviewer, plus your own annotations and essay, on speeches you don't own."
            latest={latestExportOfKind(exports, 'reviewer_annotations')}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Delete your account</CardTitle>
          <CardDescription>Permanent. Read the consequences before you type the confirmation word.</CardDescription>
        </CardHeader>
        <CardContent>
          <DeleteAccountDialog />
        </CardContent>
      </Card>
    </div>
  )
}
