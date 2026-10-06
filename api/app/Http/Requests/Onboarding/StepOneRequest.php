<?php

namespace App\Http\Requests\Onboarding;

use App\Rules\UsernameIsAvailable;
use Illuminate\Foundation\Http\FormRequest;

class StepOneRequest extends FormRequest
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
        // This FormRequest only ever runs behind `auth:sanctum`, same
        // guarantee as every controller's `$request->user()` — see
        // Controller::currentUser() for the full reasoning. A bare
        // `abort_if` here, not that helper, since FormRequest doesn't
        // extend the controller base.
        abort_if($user === null, 401);

        return [
            'first_name' => ['required', 'string', 'max:60'],
            'last_name' => ['required', 'string', 'max:60'],
            'username' => ['required', 'string', new UsernameIsAvailable($user->id)],
        ];
    }
}
