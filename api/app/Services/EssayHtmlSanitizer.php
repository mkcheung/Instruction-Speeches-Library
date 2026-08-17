<?php

namespace App\Services;

use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;

/**
 * STEP-08-essay.md / the frozen STEP-08 backend contract's strict allowlist:
 * `p, br, strong, em, u, s, h2, h3, blockquote, ul, ol, li, code, pre,
 * a[href]` and nothing else — no `style`, `class`, `id`, `img`. `a[href]` is
 * restricted to `http`/`https`/`mailto` schemes, and `rel="noopener
 * noreferrer nofollow"` is FORCED on every link on output regardless of
 * what was submitted (`forceAttribute` overwrites, it doesn't merely fill a
 * gap).
 *
 * This is the SINGLE sanitization boundary, called from both
 * `EssayService::update()` (write) and `EssayResource` (read) — R14's
 * defense in depth. Every element not explicitly allowed here is dropped
 * by `HtmlSanitizerConfig`'s own default (`HtmlSanitizerAction::Drop`,
 * removes the element AND its children), which is deliberately not relaxed
 * to `Block`: an unknown wrapper tag pasted from somewhere hostile should
 * not get its contents smuggled through just because the wrapper itself
 * was stripped.
 */
class EssayHtmlSanitizer
{
    public function sanitize(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }

        return (new HtmlSanitizer($this->config()))->sanitize($html);
    }

    private function config(): HtmlSanitizerConfig
    {
        return (new HtmlSanitizerConfig)
            ->allowElement('p')
            ->allowElement('br')
            ->allowElement('strong')
            ->allowElement('em')
            ->allowElement('u')
            ->allowElement('s')
            ->allowElement('h2')
            ->allowElement('h3')
            ->allowElement('blockquote')
            ->allowElement('ul')
            ->allowElement('ol')
            ->allowElement('li')
            ->allowElement('code')
            ->allowElement('pre')
            ->allowElement('a', ['href'])
            ->allowLinkSchemes(['http', 'https', 'mailto'])
            ->forceAttribute('a', 'rel', 'noopener noreferrer nofollow')
            // HtmlSanitizerConfig's own default (20,000 CHARACTERS, not
            // words) silently truncates anything longer before it's even
            // parsed — which would break the frozen contract's explicit
            // "a 30,000-word essay round-trips without truncation"
            // acceptance item well before word count is ever the limiting
            // factor. Raised generously (mediumText itself is good for
            // 16MB) rather than tuned to exactly this test's fixture size.
            ->withMaxInputLength(8_000_000);
    }
}
