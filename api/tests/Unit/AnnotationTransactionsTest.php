<?php

use App\Exceptions\AnnotationBusyException;
use App\Support\AnnotationTransactions;
use Illuminate\Database\Events\TransactionCommitting;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;

function annotationConcurrencyFailure(string $state): PDOException
{
    return new class($state) extends PDOException
    {
        public function __construct(string $state)
        {
            $this->code = $state;
            $this->message = 'Simulated transaction failure';
        }
    };
}

beforeEach(function () {
    // Unit tests have no enclosing RefreshDatabase transaction: exercise the
    // actual outermost transaction boundary on a fresh in-memory connection.
    DB::statement('CREATE TABLE annotation_retry_probe (id INTEGER PRIMARY KEY, value INTEGER)');
});

it('retries rollback-safe failures and commits each logical write once', function ($state) {
    $attempts = 0;
    $result = AnnotationTransactions::run(function () use (&$attempts, $state) {
        $attempts++;
        DB::table('annotation_retry_probe')->insert(['id' => 1, 'value' => $attempts]);
        if ($attempts < 3) {
            throw annotationConcurrencyFailure($state);
        }

        return 'committed';
    });
    expect($result)->toBe('committed')->and($attempts)->toBe(3)
        ->and(DB::table('annotation_retry_probe')->count())->toBe(1)
        ->and(DB::table('annotation_retry_probe')->value('value'))->toBe(3);
})->with(['40P01', '40001']);

it('bounds exhausted retries and leaves no partial write', function () {
    $attempts = 0;
    $write = function () use (&$attempts) {
        return AnnotationTransactions::run(function () use (&$attempts) {
            $attempts++;
            DB::table('annotation_retry_probe')->insert(['id' => 1, 'value' => 1]);
            throw annotationConcurrencyFailure('40P01');
        });
    };
    expect($write)->toThrow(AnnotationBusyException::class);
    expect($attempts)->toBe(3)->and(DB::table('annotation_retry_probe')->count())->toBe(0);
});

it('never retries an ambiguous connection failure', function () {
    $attempts = 0;
    $write = function () use (&$attempts) {
        return AnnotationTransactions::run(function () use (&$attempts) {
            $attempts++;
            throw annotationConcurrencyFailure('08006');
        });
    };
    expect($write)->toThrow(PDOException::class);
    expect($attempts)->toBe(1);
});

it('never repeats an already committed write when an after-commit callback fails', function () {
    $attempts = 0;
    $write = function () use (&$attempts) {
        return AnnotationTransactions::run(function () use (&$attempts) {
            $attempts++;
            DB::table('annotation_retry_probe')->insert(['id' => 1, 'value' => 1]);
            DB::afterCommit(fn () => throw annotationConcurrencyFailure('40001'));
        });
    };
    expect($write)->toThrow(PDOException::class);
    expect($attempts)->toBe(1)->and(DB::table('annotation_retry_probe')->count())->toBe(1);
});

it('propagates nested failures to the outer transaction owner without local replay', function () {
    $attempts = 0;
    $write = function () use (&$attempts) {
        return DB::transaction(function () use (&$attempts) {
            return AnnotationTransactions::run(function () use (&$attempts) {
                $attempts++;
                throw annotationConcurrencyFailure('40001');
            });
        });
    };
    expect($write)->toThrow(Exception::class);
    expect($attempts)->toBe(1)->and(DB::transactionLevel())->toBe(0);
});

it('discards failed-commit callbacks before replaying the transaction', function () {
    $commits = 0;
    Event::listen(TransactionCommitting::class, function () use (&$commits) {
        if (++$commits === 1) {
            throw annotationConcurrencyFailure('40001');
        }
    });
    $attempts = 0;
    $callbacks = [];
    AnnotationTransactions::run(function () use (&$attempts, &$callbacks) {
        $attempt = ++$attempts;
        DB::table('annotation_retry_probe')->insert(['id' => 1, 'value' => $attempt]);
        DB::afterCommit(function () use (&$callbacks, $attempt) {
            $callbacks[] = $attempt;
        });
    });
    expect($attempts)->toBe(2)->and($callbacks)->toBe([2])
        ->and(DB::table('annotation_retry_probe')->value('value'))->toBe(2)
        ->and(DB::transactionLevel())->toBe(0);
});
