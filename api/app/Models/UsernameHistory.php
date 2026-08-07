<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['username', 'user_id', 'released_at'])]
class UsernameHistory extends Model
{
    // Eloquent's default pluralization of "UsernameHistory" is
    // "username_histories" — the migration (and §6.5's literal naming)
    // uses the singular "username_history", so this must be explicit.
    protected $table = 'username_history';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'released_at' => 'datetime',
        ];
    }
}
