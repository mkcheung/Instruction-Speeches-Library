<?php

namespace App\Services\Privacy;

/**
 * The shared read-only shape STEP-11-FROZEN-CONTRACT.md §6 requires:
 * `AccountErasureService::plan()` (dry-run) and `::execute()` (the real
 * run) both return this, so `privacy:erase --dry-run` and the real audit-
 * entry metadata are built from identical structure — one cannot silently
 * drift from the other.
 *
 * `steps` is an ORDERED list (array order is the printed order) of
 * `{key, label, count, bytes}` — exactly the 8 steps of §6, in §6's exact
 * order. `count`/`bytes` are always real numbers (0 when a step touches
 * nothing), never placeholders.
 */
final class ErasurePlan
{
    /**
     * @param  list<array{key:string,label:string,count:int,bytes:int}>  $steps
     */
    public function __construct(public readonly array $steps) {}

    /**
     * @return array{key:string,label:string,count:int,bytes:int}
     */
    public function step(string $key): array
    {
        foreach ($this->steps as $step) {
            if ($step['key'] === $key) {
                return $step;
            }
        }

        throw new \InvalidArgumentException("Unknown erasure step: {$key}");
    }

    /**
     * Compact form for `audit_log.metadata` — the same counts the dry-run
     * printed, per §6's "metadata = the same row/byte counts the dry-run
     * printed."
     *
     * @return array<string, array{count:int,bytes:int}>
     */
    public function toMetadata(): array
    {
        $out = [];
        foreach ($this->steps as $step) {
            $out[$step['key']] = ['count' => $step['count'], 'bytes' => $step['bytes']];
        }

        return $out;
    }
}
