<?php

namespace App\Support;

use App\Exceptions\AnnotationBusyException;
use Closure;
use Illuminate\Support\Facades\DB;
use Throwable;

final class AnnotationTransactions
{
    /**
     * Retry only an entire transaction known to have rolled back. Nested
     * callers propagate to their outer owner; external I/O stays outside.
     *
     * @template T
     *
     * @param  Closure(): T  $callback
     * @return T
     */
    public static function run(Closure $callback): mixed
    {
        $outermost = DB::transactionLevel() === 0;
        for ($attempt = 1; ; $attempt++) {
            $committed = false;
            try {
                return DB::transaction(function () use ($callback, $outermost, &$committed) {
                    if ($outermost) {
                        // Registered before any caller's after-commit work. A
                        // failure there must never replay a committed write.
                        DB::afterCommit(function () use (&$committed): void {
                            $committed = true;
                        });
                    }

                    return $callback();
                });
            } catch (Throwable $exception) {
                if (! $outermost || $committed || ! self::knownRollback($exception)) {
                    throw $exception;
                }
                // Laravel's exhausted commit-error path lowers its nesting
                // counter without clearing the PDO transaction or pending
                // after-commit records. Neither may leak into the next attempt.
                $connection = DB::connection();
                $pdo = $connection->getPdo();
                if ($pdo->inTransaction()) {
                    $pdo->rollBack();
                }
                app('db.transactions')->rollback($connection->getName() ?? DB::getDefaultConnection(), 0);
                if ($attempt === 3) {
                    throw new AnnotationBusyException(previous: $exception);
                }
            }
        }
    }

    private static function knownRollback(Throwable $exception): bool
    {
        do {
            if (in_array((string) $exception->getCode(), ['40P01', '40001'], true)) {
                return true;
            }
        } while (($exception = $exception->getPrevious()) !== null);

        return false;
    }
}
