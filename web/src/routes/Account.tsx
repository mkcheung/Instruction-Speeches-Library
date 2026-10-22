import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { ExportSection } from '@/components/account/ExportSection'
import { DeleteAccountDialog } from '@/components/account/DeleteAccountDialog'
import { QuotaMeter } from '@/components/account/QuotaMeter'
import { useExportJob, latestExportOfKind } from '@/hooks/useExportJob'
import { useGetMeQuery } from '@/features/auth/authApi'
import { NotebookPage } from '@/components/workspace/NotebookPage'
import { useWorkspaceCompanionScene } from '@/components/workspace/useWorkspaceCompanion'

/**
 * STEP-11-FROZEN-CONTRACT.md §10: a new `/account` route, nested in
 * `App.tsx`'s existing `RequireAuth`+`RequireVerified`+`AppLayout` group —
 * not bolted onto `ProfileEdit.tsx` ("this is higher-stakes and deserves
 * its own screen," per the frontend agent's recommendation the contract
 * cites).
 *
 * Three sections: storage (§7.8 — a user who needs to free space is
 * already standing here), export (both `kind`s — "your speeches and the
 * commentary written about you" for `'account'`, the reviewer "download my
 * annotations" mitigation for `'reviewer_annotations'`), and account
 * deletion.
 */
export default function Account() {
  const scene = useWorkspaceCompanionScene()
  const { exports } = useExportJob()
  const { data: me } = useGetMeQuery()

  return (
    <NotebookPage width="form" scene={scene} title="Account & privacy">
      <Card className="workspace-notebook-surface workspace-notebook-panel">
        <CardHeader>
          <CardTitle>Storage</CardTitle>
          <CardDescription>Your speeches and uploads count against a shared quota.</CardDescription>
        </CardHeader>
        <CardContent>
          {me && <QuotaMeter usedBytes={me.user.storage_bytes_used} quotaBytes={me.user.quota_bytes} />}
        </CardContent>
      </Card>

      <Card className="workspace-notebook-surface workspace-notebook-panel">
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>Request a copy of your data as a file you can download and open.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="workspace-notebook-export">
            <ExportSection
              kind="account"
              title="Everything on your speeches"
              description="Every speech you own, plus every review on it — reviewer identity, published essays and published annotations."
              latest={latestExportOfKind(exports, 'account')}
            />
          </div>
          <div className="workspace-notebook-export">
            <ExportSection
              kind="reviewer_annotations"
              title="Your annotations as a reviewer"
              description="Every review where you're the reviewer, plus your own annotations and essay, on speeches you don't own."
              latest={latestExportOfKind(exports, 'reviewer_annotations')}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="workspace-notebook-surface workspace-notebook-panel workspace-notebook-danger">
        <CardHeader>
          <CardTitle>Delete your account</CardTitle>
          <CardDescription>Permanent. Read the consequences before you type the confirmation word.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="workspace-notebook-delete-trigger"><DeleteAccountDialog /></div>
        </CardContent>
      </Card>
    </NotebookPage>
  )
}
