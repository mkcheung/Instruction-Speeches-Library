<?php

namespace App\Http\Requests\Connection;

use Illuminate\Validation\Rule;

class ListFriendsRequest extends FindFriendsRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return parent::rules() + [
            'view' => ['sometimes', 'string', Rule::in(['accepted', 'incoming'])],
        ];
    }
}
