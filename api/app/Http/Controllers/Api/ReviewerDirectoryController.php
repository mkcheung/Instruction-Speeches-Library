<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Resources\ReviewerDirectoryResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * `GET /reviewers` — MODERNIZATION_PLAN §6.3/§7.1: the reviewer directory,
 * the ONLY reviewer-discovery mechanism (there is deliberately no
 * "reviewable speeches" open pool endpoint anywhere in this codebase).
 * Every authenticated Member/Coach may browse it — an Admin may not
 * (§7.1's matrix), enforced below via the `viewDirectory` ability
 * (PLAN-APP-HEADER.md S4 — see AppServiceProvider for the Gate::define and
 * $mustFallThrough wiring this depends on).
 */
class ReviewerDirectoryController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewDirectory');

        $users = User::query()
            ->reviewerCandidates($request->string('search')->toString() ?: null, $request->string('credential')->toString() ?: null)
            ->with('profile')
            ->orderBy('first_name')
            ->orderBy('last_name')
            // `id` breaks ties: `first_name`/`last_name` are not unique, and
            // without a deterministic final sort key the same user can appear
            // on two pages (or on neither) as the engine reorders equal rows
            // between the two LIMIT/OFFSET queries.
            ->orderBy('id')
            // `page` itself needs no argument — Illuminate\Pagination\
            // PaginationState resolves it from the request query string.
            ->paginate(20);

        return new JsonResponse([
            'reviewers' => ReviewerDirectoryResource::collection($users),
            'meta' => [
                'current_page' => $users->currentPage(),
                'last_page' => $users->lastPage(),
                'total' => $users->total(),
            ],
        ]);
    }
}
