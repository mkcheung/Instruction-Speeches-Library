<?php

namespace App\Console\Commands;

use App\Services\MediaS3ClientFactory;
use Aws\S3\Exception\S3Exception;
use Aws\S3\S3Client;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Config;

/**
 * STEP-09 verification plan §3.2: "Replace the CORS-only manual
 * prerequisite with an idempotent `media:initialize` command that: (1)
 * creates the configured bucket when absent; (2) applies the existing CORS
 * policy, including exposed `ETag`; (3) succeeds unchanged when run again."
 *
 * `media:configure-cors` (App\Console\Commands\ConfigureMediaCorsCommand)
 * already owned step (2) but assumed the bucket already existed — true on
 * an established dev volume, false on a clean E2E SeaweedFS volume where
 * nothing has ever written to the `media` bucket yet. This command adds the
 * missing bucket-creation step and then delegates CORS to the exact same
 * `corsRule()` builder that command uses, so a clean-volume CI run
 * (compose `media:initialize` step, per the plan's §3.2 CI ordering:
 * "services healthy → migrations → media:initialize → E2E seed → default
 * queue worker → Playwright") and an established dev volume converge on one
 * policy.
 *
 * Idempotent by construction: `headBucket` existence-checks before
 * `createBucket` (SeaweedFS returns its own "already owned"-shaped error on
 * a racing/duplicate create, caught below same as a real S3 endpoint would),
 * and `putBucketCors` is itself an overwrite, not an append.
 */
class MediaInitializeCommand extends Command
{
    protected $signature = 'media:initialize';

    protected $description = 'Idempotently create the media bucket (if absent) and apply its CORS policy (STEP-09 §3.2).';

    public function __construct(private readonly MediaS3ClientFactory $clients)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $config = Config::get('filesystems.disks.media');
        $bucket = (string) $config['bucket'];
        $client = $this->clients->make('media');

        if ($this->bucketExists($client, $bucket)) {
            $this->info("Bucket '{$bucket}' already exists.");
        } else {
            try {
                $client->createBucket(['Bucket' => $bucket]);
                $this->info("Bucket '{$bucket}' created.");
            } catch (S3Exception $e) {
                // A concurrent initializer (or a store that already owns
                // the bucket despite headBucket's negative answer above —
                // e.g. a race between two `media:initialize` invocations)
                // must not fail this command: the end state ("bucket
                // exists") is what idempotency promises, not exclusivity
                // of who created it.
                if (! $this->isAlreadyOwnedError($e)) {
                    throw $e;
                }

                $this->info("Bucket '{$bucket}' already exists (created concurrently).");
            }
        }

        $origins = Config::get('cors.allowed_origins', []);

        $client->putBucketCors([
            'Bucket' => $bucket,
            'CORSConfiguration' => [
                'CORSRules' => [ConfigureMediaCorsCommand::corsRule($origins)],
            ],
        ]);

        $this->info("Bucket '{$bucket}' CORS policy applied, exposing ETag/Range headers for ".implode(', ', $origins ?: ['*']).'.');

        return self::SUCCESS;
    }

    private function bucketExists(S3Client $client, string $bucket): bool
    {
        try {
            $client->headBucket(['Bucket' => $bucket]);

            return true;
        } catch (S3Exception $e) {
            $status = $e->getStatusCode();

            if ($status === 404 || $status === 403) {
                return false;
            }

            throw $e;
        }
    }

    private function isAlreadyOwnedError(S3Exception $e): bool
    {
        $code = (string) $e->getAwsErrorCode();

        return $code === 'BucketAlreadyOwnedByYou' || $code === 'BucketAlreadyExists';
    }
}
