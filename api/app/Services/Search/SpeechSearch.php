<?php

namespace App\Services\Search;

use App\Models\Speech;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\Relation;
use LogicException;

class SpeechSearch
{
    public function __construct(private readonly SearchTextMatcher $matcher) {}

    /** @return Collection<int, Speech> */
    public function find(int $ownerId, string $query): Collection
    {
        // Explicit ! escaping leaves backslash and regex punctuation literal.
        $pattern = '%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $query).'%';
        $fields = [
            'title' => 'speeches.title',
            'description' => "COALESCE(speeches.description, '')",
            'body' => "COALESCE(search_transcript.body, '')",
        ];
        $speeches = Speech::query()
            // The unique transcript join selects eligibility and text from one
            // MVCC snapshot, including during concurrent projection replacement.
            ->leftJoin('speech_transcripts as search_transcript', 'search_transcript.speech_id', '=', 'speeches.id')
            ->select('speeches.*')
            ->selectRaw("COALESCE(search_transcript.body, '') AS search_body")
            ->selectRaw('LOWER(?) AS search_needle', [$query])
            ->where('speeches.user_id', $ownerId)
            ->where(function (Builder $builder) use ($fields, $pattern): void {
                foreach ($fields as $column) {
                    $builder->orWhereRaw("LOWER({$column}) LIKE LOWER(?) ESCAPE '!'", [$pattern]);
                }
            });
        foreach ($fields as $name => $column) {
            $speeches->selectRaw("LOWER({$column}) AS search_lower_{$name}")
                ->selectRaw("CASE WHEN LOWER({$column}) LIKE LOWER(?) ESCAPE '!' THEN 1 ELSE 0 END AS search_matches_{$name}", [$pattern]);
        }
        $results = $speeches->with([
            'primaryVideo',
            'supersedes',
            'assets' => fn (Relation $relation) => $relation->whereIn('kind', ['poster', 'sprite']),
        ])->orderByDesc('speeches.created_at')->orderByDesc('speeches.id')->get();

        foreach ($results as $speech) {
            $needle = $this->text($speech, 'search_needle');
            $title = $this->matcher->parts($speech->title, $this->text($speech, 'search_lower_title'), $needle);
            $description = $speech->description === null || $speech->description === ''
                ? null : $this->matcher->parts($speech->description, $this->text($speech, 'search_lower_description'), $needle);
            $excerpt = $this->matcher->excerpt($this->text($speech, 'search_body'), $this->text($speech, 'search_lower_body'), $needle);
            // Guard every field in both directions: another field's match must
            // never conceal a fabricated or missing excerpt/highlight.
            foreach (['title' => $this->hasMatch($title), 'description' => $this->hasMatch($description ?? []), 'body' => $excerpt !== null] as $name => $matched) {
                if ($matched !== ((int) $speech->getAttribute('search_matches_'.$name) === 1)) {
                    throw new LogicException('Database search eligibility and displayed matches disagree for '.$name.'.');
                }
            }
            $speech->setAttribute('search_match', ['title' => $title, 'description' => $description, 'transcript_excerpt' => $excerpt]);
        }

        return $results;
    }

    private function text(Speech $speech, string $attribute): string
    {
        $value = $speech->getAttribute($attribute);
        if (! is_string($value)) {
            throw new LogicException('Expected a textual database search projection.');
        }

        return $value;
    }

    /** @param list<array{text: string, matched: bool}> $parts */
    private function hasMatch(array $parts): bool
    {
        foreach ($parts as $part) {
            if ($part['matched']) {
                return true;
            }
        }

        return false;
    }
}
