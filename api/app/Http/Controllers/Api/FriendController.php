<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Connection\FindFriendsRequest;
use App\Http\Requests\Connection\ListFriendsRequest;
use App\Http\Requests\Connection\SampleFriendsRequest;
use App\Http\Resources\FriendCandidateResource;
use App\Http\Resources\FriendResource;
use App\Models\User;
use App\Services\FriendDirectoryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use stdClass;

class FriendController extends Controller
{
    public function index(ListFriendsRequest $request, FriendDirectoryService $directory): JsonResponse
    {
        $view = $request->validated('view', 'accepted');
        $page = $directory->friends($this->currentUser($request), $view,
            $request->validated('search') ?? '', $request->validated('cursor'));

        return new JsonResponse(['friends' => $this->items($page, FriendResource::class, $request),
            'meta' => ['total' => $page['total'], 'next_cursor' => $page['next_cursor']]]);
    }

    public function sample(SampleFriendsRequest $request, FriendDirectoryService $directory): JsonResponse
    {
        $page = $directory->sample($this->currentUser($request), (int) $request->validated('limit', 9));

        return new JsonResponse(['friends' => $this->items($page, FriendResource::class, $request), 'meta' => ['total' => $page['total']]]);
    }

    public function find(FindFriendsRequest $request, FriendDirectoryService $directory): JsonResponse
    {
        $page = $directory->find($this->currentUser($request),
            $request->validated('search') ?? '', $request->validated('cursor'));

        return new JsonResponse(['people' => $this->items($page, FriendCandidateResource::class, $request),
            'meta' => ['next_cursor' => $page['next_cursor']]]);
    }

    public function relationship(Request $request, User $user, FriendDirectoryService $directory): JsonResponse
    {
        return new JsonResponse(['relationship' => $directory->relationship($this->currentUser($request), $user)]);
    }

    /**
     * Each directory row rendered with its own mutual-friend count.
     *
     * @param  array{rows: Collection<int, stdClass>, mutual: array<int, int>}  $page
     * @param  class-string<FriendResource|FriendCandidateResource>  $resource
     * @return Collection<int, array<mixed>>
     */
    private function items(array $page, string $resource, Request $request): Collection
    {
        return $page['rows']->map(fn (stdClass $row): array => (new $resource($row, $page['mutual'][(int) $row->person_id] ?? 0))->resolve($request));
    }
}
