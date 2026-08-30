<?php

namespace App\Models;

use Database\Factories\DataExportFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * STEP-11-FROZEN-CONTRACT.md §7. Mirrors `speech_assets`' status-enum
 * shape. `@property` block: raw `DB::statement` migration (CHECK
 * constraints), invisible to Larastan's Blueprint-AST scanner.
 *
 * @property int $id
 * @property int $user_id
 * @property string $kind
 * @property string $status
 * @property string $disk
 * @property string|null $path
 * @property int|null $byte_size
 * @property Carbon|null $expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['user_id', 'kind', 'status', 'disk', 'path', 'byte_size', 'expires_at'])]
class DataExport extends Model
{
    /** @use HasFactory<DataExportFactory> */
    use HasFactory;

    public const KINDS = ['account', 'reviewer_annotations'];

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
        ];
    }
}
