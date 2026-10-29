{{-- The scene key comes from AdminScene's exact page allowlist, never request data. --}}
<div
    @class([
        'admin-workspace-scene',
        'admin-workspace-scene--compact' => $scene['compact'],
    ])
    data-admin-scene="{{ $scene['key'] }}"
    aria-hidden="true"
    style="pointer-events: none"
>
    @includeIf('filament.admin.scenes.' . $scene['key'])
</div>
