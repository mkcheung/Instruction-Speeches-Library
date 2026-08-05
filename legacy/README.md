# The legacy tree — 2013–2014

**Do not run this. It cannot run.** It is kept deliberately, as evidence and as a specification.

## What this is

A PHP 5 learning project, originally called `ToastmasterLibrary`, built between **2013-03-06 and 2014-10-30** and then abandoned mid-refactor. 6,800 lines of PHP across 75 files. No framework, no dependency manager, no tests, no migrations, no schema.

**This is only a fragment.** The `.sublime-workspace` buffer paths show it was the `includes/` subdirectory of a larger application — so every stylesheet, vendored library, image and video the code references lived in sibling directories that were never under version control. `styles.css` here is 9 lines of z-index rules; the real one is gone.

## Why it was kept rather than deleted

Three reasons, in order of importance:

**1. It is the specification.** Nobody wrote down what this application was supposed to do. The code is the only surviving statement of intent — which table meant what, which screens existed, what the annotation feature was reaching for. [`viewTopicVideo.php:84-96`](viewTopicVideo.php) is a working timestamped-commentary implementation, and it is the reference the rebuild's core feature is designed against.

**2. It is the evidence.** [`../MODERNIZATION_PLAN.md`](../MODERNIZATION_PLAN.md) makes **157 citations into these files**, by name and line number. Without the tree, every one of those is an unverifiable assertion. With it, you can check them.

**3. The git history is part of the story.** Sixteen commits, then an eleven-year gap, then a rebuild plan. `git log --follow legacy/login.php` still works.

## Why it cannot run

Summarized from [Appendix A](../MODERNIZATION_PLAN.md) of the plan, which lists these with citations:

- **`mysql_*` functions in 33 files.** `ext/mysql` was removed in PHP 7.0, so every data-layer call is undefined.
- **Three files are parse errors** under modern PHP: `DatabaseObject2.php`, `DatabaseObjectX.php`, `sampleClass.php`.
- **`login.php` fatals** on an include (`EmailInterface.php`) that is absent from all sixteen commits.
- **Every `INSERT` fails on modern MySQL.** `DatabaseObject::create()` puts `id` in every column list and sends `id=''`, which `STRICT_TRANS_TABLES` rejects.
- **Popcorn.js**, which the annotation feature depends on, has been archived read-only since 2018.

## The two structural problems worth knowing about

These are why the project was never finishable, as opposed to merely unfinished:

**The `notes` table has no author column.** Timestamped commentary exists; attribution never did. Four of the product's stated requirements depend on knowing who wrote a note, and none of them could be built. The rebuild's central design decision — merging the access grant and the annotation set into one `reviews` row — exists to make an unattributed annotation *structurally impossible*.

**There is no ownership check anywhere.** Any authenticated user could enumerate `viewTopicVideo.php?topId=1,2,3…` and watch every private speech in the system. The rebuild's "nobody sees your speech unless you invited them" rule is a direct response.

## No credentials here

Checked before publishing: `constants.php` has an empty password, user `host`, database `test`, host `localhost`. The other files matching `password` are form fields and column names. **Nothing sensitive.**

---

**Start here instead:** [`../README.md`](../README.md) · [`../MODERNIZATION_PLAN.md`](../MODERNIZATION_PLAN.md) · [`../STEPS.md`](../STEPS.md)
