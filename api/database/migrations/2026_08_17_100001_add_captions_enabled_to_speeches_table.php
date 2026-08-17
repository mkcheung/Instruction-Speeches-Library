<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * STEP-09-captions.md / the frozen STEP-09 backend contract §3: §20
     * Q12's off-switch is "a new column, not a separate settings table" —
     * this project has no settings/preferences table anywhere yet and one
     * boolean doesn't justify starting one. Defaults to `true` (automatic-
     * with-an-off-switch, per STEP-09.md's "§20 Q12 is answered here").
     *
     * Toggling this later does not retroactively delete an already-
     * generated transcript (App\Jobs\GenerateCaptions and
     * SpeechUploadController only consult it before dispatching a NEW
     * caption job) — enforced in application code, nothing for this
     * migration itself to encode.
     *
     * Plain `ADD COLUMN`, no CHECK constraint needed — same reasoning as
     * the essay-columns ALTER on `reviews`: only a CHECK-constraint rewrite
     * needs driver-branched raw SQL, and there isn't one here.
     */
    public function up(): void
    {
        Schema::table('speeches', function ($table): void {
            $table->boolean('captions_enabled')->default(true);
        });
    }

    public function down(): void
    {
        Schema::table('speeches', function ($table): void {
            $table->dropColumn('captions_enabled');
        });
    }
};
