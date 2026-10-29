<?php

namespace App\Support;

use Filament\Support\Assets\Css;
use Filament\Support\Assets\Font;
use Filament\Support\Facades\FilamentAsset;
use Illuminate\Contracts\Support\Htmlable;

/** Panel-only assets, published by filament:assets into nginx's served namespaces. */
final class AdminWorkspaceAssets
{
    public const PACKAGE = 'filament/admin';

    public const STYLE = 'admin-workspace';

    /** @return array<Css|Font> */
    public static function assets(): array
    {
        return [
            Css::make(self::STYLE, resource_path('css/filament/admin-workspace.css'))
                ->relativePublicPath('css/filament/admin/admin-workspace-'.self::version('css/filament/admin-workspace.css').'.css')
                ->loadedOnRequest(),
            Font::make(self::fontId(), resource_path('fonts/admin')),
        ];
    }

    public static function fontStylesheetUrl(): string
    {
        return asset('fonts/'.self::PACKAGE.'/'.self::fontId().'/index.css');
    }

    public static function stylesheetHtml(): Htmlable
    {
        return Css::make(self::STYLE)
            ->html(FilamentAsset::getStyleHref(self::STYLE, self::PACKAGE))
            ->getHtml();
    }

    private static function fontId(): string
    {
        // The stylesheet references content-hashed font filenames, so its hash versions both.
        return 'notebook-'.self::version('fonts/admin/index.css');
    }

    private static function version(string $path): string
    {
        $file = resource_path($path);

        // Missing assets should degrade to the system font/theme, not break panel boot.
        $hash = is_file($file) ? hash_file('sha256', $file) : false;

        return $hash !== false ? substr($hash, 0, 16) : 'missing';
    }
}
