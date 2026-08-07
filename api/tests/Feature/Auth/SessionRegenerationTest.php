<?php

use App\Models\User;

it('regenerates the session id on login', function () {
    $user = User::factory()->create(['password' => bcrypt('correct-horse')]);

    // Establish a session by hitting a `web`-group route before login (the
    // `api` group only starts a session for requests Sanctum recognizes as
    // "from the frontend" — see EnsureFrontendRequestsAreStateful — so a
    // plain `/api/*` hit here would prove nothing).
    $this->get('/');
    $idBeforeLogin = session()->getId();

    $this->postJson('/login', [
        'email' => $user->email,
        'password' => 'correct-horse',
    ])->assertOk();

    $idAfterLogin = session()->getId();

    expect($idAfterLogin)->not->toBe($idBeforeLogin);
});
