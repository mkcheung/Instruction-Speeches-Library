# CP-04 — Service containers, caching, and the codec trap

> **Optional.** [Step 05](STEP-05-invitation-loop.md) does not depend on this.

**Track:** CI · **Time:** ~4h · **After:** [Step 04](STEP-04-every-video-plays.md) · **Then:** [Step 05](STEP-05-invitation-loop.md)

---

## 🎯 What you are learning here

1. What a **service container** is, and why CI needs a real database rather than a mock.
2. **Why health checks exist** — and what the failure looks like without one.
3. How caching works: **the key is the whole design**, and a bad key is worse than no cache.
4. **That "the same tool" can behave differently by CPU architecture** — with a live example you can reproduce on your own laptop.

---

## Why a real database in CI

You could mock the database. People do. Here's why you shouldn't:

**A mock encodes what you *believe* the database does.** Your unique constraints, your cascade rules, your `CHECK` constraints, your transaction behaviour — a mock has none of that unless you reimplement it, and if you reimplement it you're testing your reimplementation.

This plan leans on the database for correctness *deliberately*. §6.3 makes a whole argument that **invariants belong in the schema, not in application code** — `UNIQUE(speech_id, reviewer_id)`, `review_id NOT NULL`, the `< id` acyclicity check. **A mocked database tests none of those.** You'd be skipping exactly the part the design depends on.

A service container is how you get the real thing: GitHub starts a PostgreSQL container alongside your job, on the same network, and tears it down after.

---

## Setup — in order

### 1. Add PostgreSQL

```yaml
jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: test
        ports:
          - 5432:5432
        # WHY: without this, your app connects before Postgres is listening.
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v7
      # ... setup-php, setup-node ...

      - name: Migrate
        working-directory: api
        env:
          DB_CONNECTION: pgsql
          DB_HOST: 127.0.0.1
          DB_PORT: 5432
          DB_DATABASE: test
          DB_USERNAME: test
          DB_PASSWORD: test
        run: php artisan migrate --force
```

### 2. Time it, then cache, then time it again

**Write the number down first.** You cannot see the improvement without a baseline, and "it feels faster" is not a measurement.

`setup-node` already caches npm from [CP-00](CP-00-first-workflow.md). Composer needs doing by hand:

```yaml
      - name: Cache Composer
        uses: actions/cache@v6
        with:
          path: api/vendor
          # WHY the lockfile hash: the key must change exactly when the
          # dependencies change. Not more often, not less.
          key: composer-${{ hashFiles('api/composer.lock') }}
          restore-keys: composer-
```

Push twice. **Compare the two times.** That delta is the lesson.

### 3. Prove the cache invalidates

Add a dependency. Push. **Watch the log say cache miss**, then repopulate. If it says hit, your key is wrong and you're now running against stale dependencies — which is a silent, confusing category of bug.

---

## Why caching is mostly about the key

A cache has one job: **be correct.** Fast-and-wrong is worse than slow-and-right, because slow is visible and wrong is not.

The key controls correctness:

| Key | Behaviour |
|---|---|
| `composer` (fixed) | ❌ Never invalidates. You run old dependencies forever and cannot tell. |
| `composer-${{ github.sha }}` | ❌ Changes every commit. Never a hit. A cache that never hits is just slower. |
| `composer-${{ hashFiles('composer.lock') }}` | ✅ Changes exactly when dependencies change |

`restore-keys` is a **fallback prefix**: on a miss, take the most recent key starting with `composer-` and use it as a *starting point*. So adding one package restores the other 200 from cache and fetches one — most of the benefit, none of the staleness.

**Why `setup-node` can do this automatically and `setup-php` cannot:** npm has one canonical lockfile location and one canonical cache directory. PHP projects vary more, so `setup-php` leaves it to you. **Verified: there is no built-in Composer cache** — its own README still shows `actions/cache`.

---

## ⚠️ The codec trap — and it is not where you'd expect

This bit is specific to your app, and the received wisdom about it is **now wrong**.

**The old story** (true until late 2025): Playwright's `chromium` is open-source Chromium, which lacks proprietary codecs, so **H.264 video doesn't play in CI** even though it plays on your Mac. The fix was `channel: 'chrome'`.

**What actually changed:** since **Playwright 1.57** (2025-11-25), the browser called `chromium` is **Chrome for Testing** — on macOS arm64 and **Linux x64**. Those builds **do** have H.264 and AAC.

| Platform | What you get | H.264 |
|---|---|---|
| macOS arm64 (your laptop) | Chrome for Testing | ✅ |
| Linux **x64** (`ubuntu-latest`) | Chrome for Testing | ✅ |
| Linux **arm64** (`ubuntu-*-arm`, **arm64 Docker**) | open-source Chromium | ❌ |

**So on `ubuntu-latest`, your video plays and no workaround is needed.**

> ### The trap relocated — and it now fires on your own machine
>
> **A Playwright container on an Apple Silicon Mac is `linux/arm64`.** So the same test passes on your host and fails in your own container, on the same laptop, with the same command.
>
> **This is the better lesson**, and you can reproduce it in ten minutes: run the video test on your host, then in an arm64 container, and watch them diverge.
>
> **The transferable idea:** "the same tool" is not the same everywhere. Architecture, OS and distribution channel all change what you actually get. This is why "works on my machine" survives even *with* containers — containers pin the OS, not the CPU.

**⚠️ Two cautions:**
- **Do not assume `channel: 'chrome'` rescues arm64 Linux.** Google may not ship a Linux arm64 Chrome at all. **Unverified.** The honest fallback is a VP9/WebM fixture for most tests and running H.264 tests on x64.
- **Playwright's own browsers documentation still describes the pre-1.57 behaviour.** The release notes are correct; that page is stale. Being misled by official docs is itself worth experiencing once.

---

## ⚠️ You will hit this

**Connection refused, intermittently.** No health check, or you didn't wait for it. This is the failure health checks exist to prevent, and it's intermittent, which makes it maddening.

**`localhost` vs `127.0.0.1`.** Service ports map to the runner's localhost. IPv6 resolution occasionally makes `localhost` resolve somewhere unhelpful; `127.0.0.1` is the reliable form.

**Cached `vendor/` but not the Composer download cache.** Caching `~/.composer/cache` too gets you a faster *miss*, which is where most time goes.

**The video test fails and you blame your code.** Check the architecture first now that you know.

---

## Done when

- [ ] Tests run against real PostgreSQL in CI
- [ ] You have **two timings written down** and can state the saving
- [ ] You proved the cache invalidates by adding a dependency
- [ ] You reproduced the arm64 codec difference — **on your own laptop**

Understanding:

- [ ] Why not mock the database, given this plan's schema design specifically?
- [ ] What does a health check prevent, and what does that failure look like?
- [ ] Why is `key: composer` (fixed) worse than no cache at all?
- [ ] What does `restore-keys` buy you?
- [ ] Why does the same Playwright command give different codec support on two machines?

---

**Next:** [Step 05 — The invitation loop](STEP-05-invitation-loop.md), then [CP-05](CP-05-two-users-one-test.md).
