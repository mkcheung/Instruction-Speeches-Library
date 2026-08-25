export function canRecordVoiceForRoles(roles: readonly string[]): boolean {
  return roles.includes('coach') && !roles.includes('admin') && !roles.includes('super_admin')
}
