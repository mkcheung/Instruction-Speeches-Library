<?php

namespace App\Http\Requests;

use App\Rules\UsernameIsAvailable;
use Illuminate\Foundation\Http\FormRequest;

class UpdateUsernameRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        $user = $this->user();
        // Same `auth:sanctum`-guarantees-non-null reasoning as
        // Controller::currentUser() — see that method's docblock. A bare
        // `abort_if` here since FormRequest doesn't extend the controller
        // base.
        abort_if($user === null, 401);

        return [
            'username' => ['required', 'string', new UsernameIsAvailable($user->id)],
        ];
    }
}
