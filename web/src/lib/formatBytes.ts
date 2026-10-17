/**
 * Ports `UserResource::formatBytes` (`api/app/Filament/Resources/UserResource.php`,
 * ~line 155) to TypeScript verbatim, so the Filament admin table and the
 * speaker-facing quota meter (§7.8) never disagree about what "4.9 GiB"
 * means. Binary (1024-based) units; zero decimal places for raw bytes, one
 * decimal place for everything else — matching the PHP:
 *
 *   $power = $bytes > 0 ? min((int) floor(log($bytes, 1024)), count($units) - 1) : 0;
 *   $value = $bytes / (1024 ** $power);
 *   return number_format($value, $power === 0 ? 0 : 1).' '.$units[$power];
 *
 * `number_format` also inserts a "," thousands separator, which matters
 * once a value's integer part reaches 4+ digits — the units array caps at
 * TiB (no unit above it to roll over into), so a multi-TiB `quota_bytes`
 * (the docblock on `CurrentUser.quota_bytes` notes it "can be individually
 * raised per user") renders as e.g. "1,024.0 TiB" in PHP. `toFixed` alone
 * doesn't add that separator, which would make this port disagree with the
 * admin table it's supposed to match exactly — `toLocaleString` does.
 */
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const

export function formatBytes(bytes: number): string {
  const power = bytes > 0 ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1) : 0
  const value = bytes / 1024 ** power
  const decimals = power === 0 ? 0 : 1
  const formattedValue = value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${formattedValue} ${UNITS[power]}`
}
