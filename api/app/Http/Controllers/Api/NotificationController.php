<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * STEP-05-invitation-loop.md's in-app notification bell. Thin read/mark-read
 * surface over Laravel's stock `DatabaseNotification` (the `notifications`
 * table + `Notifiable::notifications()`) — the actual notifications are
 * queued/written by App\Notifications\{ReviewInvited,ReviewAccepted,
 * ReviewDeclined} via ReviewService, not by this controller.
 */
class NotificationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $notifications = $user->notifications()
            ->latest()
            ->limit(50)
            ->get()
            ->map(fn ($notification) => [
                'id' => $notification->id,
                'type' => $notification->data['type'] ?? $notification->type,
                'data' => $notification->data,
                'read_at' => $notification->read_at,
                'created_at' => $notification->created_at,
            ]);

        return new JsonResponse([
            'notifications' => $notifications,
            'unread_count' => $user->unreadNotifications()->count(),
        ]);
    }

    public function markRead(Request $request, string $notification): JsonResponse
    {
        $record = $request->user()->notifications()->findOrFail($notification);
        $record->markAsRead();

        return new JsonResponse(null, Response::HTTP_NO_CONTENT);
    }
}
