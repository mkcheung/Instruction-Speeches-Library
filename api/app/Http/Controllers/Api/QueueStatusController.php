<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Redis;

/**
 * §9.5's backpressure signal: the depth of the dedicated `transcode` queue
 * (App\Jobs\TranscodeSpeechAsset's `redis-long` connection / `transcode`
 * queue, config/queue.php), read straight off Redis rather than through any
 * per-speech/per-asset scoping — it's a single global gauge the frontend
 * polls to decide whether to show a "processing is backed up" banner, not
 * a status for any one upload.
 *
 * `queues:transcode` is the literal key Laravel's redis queue driver
 * (Illuminate\Queue\RedisQueue::getQueue) writes list entries under; the
 * `Redis` facade's connection-level `options.prefix` (config/database.php)
 * is applied transparently underneath every command issued through it, so
 * this call site does not need to know or duplicate that prefix itself.
 */
class QueueStatusController extends Controller
{
    public function __invoke(): JsonResponse
    {
        return new JsonResponse([
            'depth' => (int) Redis::connection()->llen('queues:transcode'),
        ]);
    }
}
