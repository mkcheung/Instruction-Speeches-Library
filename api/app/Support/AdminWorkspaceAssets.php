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

    private const STYLE_SOURCE = 'css/filament/admin-workspace.css';

    private const FONT_DIRECTORY = 'fonts/admin';

    /**
     * Memoized per PHP process. Under php-fpm that is one request, and the
     * panel provider builds these assets on every request (API included), so
     * each request still hashes both sources once.
     *
     * @var array<string, string>
     */
    private static array $versions = [];

    /** @return array<Css|Font> */
    public static function assets(): array
    {
        return [
            Css::make(self::STYLE, resource_path(self::STYLE_SOURCE))
                ->relativePublicPath('css/filament/admin/admin-workspace-'.self::version(self::STYLE_SOURCE).'.css')
                ->loadedOnRequest(),
            Font::make(self::fontId(), resource_path(self::FONT_DIRECTORY)),
        ];
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
        return 'notebook-'.self::version(self::FONT_DIRECTORY.'/index.css');
    }

    private static function version(string $path): string
    {
        if (! isset(self::$versions[$path])) {
            $file = resource_path($path);

            // Missing or unreadable assets degrade to the system font/theme rather
            // than raising a warning inside panel registration, which runs on every request.
            $hash = is_file($file) && is_readable($file) ? hash_file('sha256', $file) : false;

            self::$versions[$path] = $hash !== false ? substr($hash, 0, 16) : 'missing';
        }

        return self::$versions[$path];
    }
}
