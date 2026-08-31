<?php

namespace App\Http\Resources;

use App\Models\ApplicationDocument;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Deliberately excludes `disk`/`path`/`sha256` from the applicant-facing
 * response — those are storage internals, not something the API ever
 * hands to a non-admin caller. The admin/Filament side reads the model
 * directly rather than through this resource.
 *
 * @mixin ApplicationDocument
 */
class ApplicationDocumentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'original_filename' => $this->original_filename,
            'byte_size' => $this->byte_size,
            'status' => $this->status,
            'created_at' => $this->created_at,
        ];
    }
}
