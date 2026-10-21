import type { ReactNode } from 'react'
import { ActivityScene } from './ActivityScene'
import './workspace.css'

export function WorkspaceLoginFrame({ children }: { children: ReactNode }) {
  return (
    <div className="workspace-login">
      <div className="workspace-login-stage">
        <div className="workspace-login-brand">Instruction Speeches Library</div>
        <div className="workspace-login-grid">
          <div className="workspace-login-welcome">
            <ActivityScene scene="welcome" variant="login" />
          </div>
          <div className="workspace-login-form">{children}</div>
        </div>
      </div>
    </div>
  )
}
