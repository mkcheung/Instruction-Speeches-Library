<?php

use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\PresignController;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class)->name('api.health');

// Spike-wall only (S0): no auth yet, per STEP-00-foundation.md.
Route::get('/spikes/presign', PresignController::class)->name('api.spikes.presign');
