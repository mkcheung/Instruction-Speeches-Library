<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Connection\FindFriendsRequest;
use App\Http\Requests\Connection\ListFriendsRequest;
use App\Http\Resources\FriendCandidateResource;
use App\Http\Resources\FriendResource;
use App\Models\User;
use App\Services\FriendDirectoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use stdClass;

class FriendController extends Controller
{
    public function index(ListFriendsRequest $request, FriendDirectoryService $directory): JsonResponse
    {
        $view = $request->validated('view', 'accepted');
        $page = $directory->friends($this->currentUser($request), $view,
            $request->validated('search') ?? '', $request->validated('cursor'));
        $items = $page['rows']->map(fn (stdClass $row): array => (new FriendResource($row, $page['mutual'][(int) $row->person_id] ?? 0))->resolve($request));

        return new JsonResponse(['friends' => $items, 'meta' => ['total' => $page['total'], 'next_cursor' => $page['next_cursor']]]);
    }

    public function find(FindFriendsRequest $request, FriendDirectoryService $directory): JsonResponse
    {
        $page = $directory->find($this->currentUser($request),
            $request->validated('search') ?? '', $request->validated('cursor'));
        $items = $page['rows']->map(fn (stdClass $row): array => (new FriendCandidateResource($row, $page['mutual'][(int) $row->person_id] ?? 0))->resolve($request));

        return new JsonResponse(['people' => $items, 'meta' => ['next_cursor' => $page['next_cursor']]]);
    }

    public function relationship(Request $request, User $user, FriendDirectoryService $directory): JsonResponse
    {
        return new JsonResponse(['relationship' => $directory->relationship($this->currentUser($request), $user)]);
    }
}
