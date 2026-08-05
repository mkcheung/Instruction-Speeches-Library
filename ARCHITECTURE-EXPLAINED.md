# The Speech Coaching Platform
## How it works, and why it's built this way

*A plain-language walkthrough of the architecture, the tools, the database and the plan for growth.*

**Companion to:** [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md) (the full technical specification) and [STEPS.md](STEPS.md) (the build order)
**Date:** 2026-08-05 · Plan revision 5

---

## Contents

1. [What we're building](#1-what-were-building)
2. [The big picture — four boxes](#2-the-big-picture--four-boxes)
3. [The front of the house — what runs in your browser](#3-the-front-of-the-house--what-runs-in-your-browser)
4. [RTK Query — the smart assistant](#4-rtk-query--the-smart-assistant)
5. [The back of the house — what runs on the server](#5-the-back-of-the-house--what-runs-on-the-server)
6. [The database — the card catalogue](#6-the-database--the-card-catalogue)
7. [The schema — the shape of the information](#7-the-schema--the-shape-of-the-information)
8. [The video pipeline — from your phone to the screen](#8-the-video-pipeline--from-your-phone-to-the-screen)
9. [Whisper — the robot that listens](#9-whisper--the-robot-that-listens)
10. [The annotation engine — the heart of the product](#10-the-annotation-engine--the-heart-of-the-product)
11. [Who can see what](#11-who-can-see-what)
12. [Containers — the matching lunchboxes](#12-containers--the-matching-lunchboxes)
13. [Growing up — what happens when it gets big](#13-growing-up--what-happens-when-it-gets-big)
14. [The money question](#14-the-money-question)
15. [One-page cheat sheet](#15-one-page-cheat-sheet)

---

# 1. What we're building

Imagine you're learning to give speeches.

You record yourself giving one. You send it to someone whose opinion you trust. They watch it — and instead of writing you a vague email a week later, **they leave notes stuck to specific moments in the video.**

At 1:23 they write *"great pause here."* At 3:40, *"you said 'um' four times in this sentence."*

Then you watch your own speech again, and **their notes appear right when they're relevant** — fading in at the right second, fading out a few seconds later. Some of them are spoken out loud: the video pauses, you hear their voice, and then it carries on.

That's the whole product.

## The parts

| Piece | In plain words |
|---|---|
| **Speech** | A video you uploaded of yourself talking |
| **Reviewer** | Someone you invited to give you feedback |
| **Annotation** | One note, stuck to one moment in the video |
| **Essay** | A longer written response, underneath the video |
| **Review** | Everything one reviewer did on one speech, bundled together |

## The three kinds of people

- **Member** — everyone starts here. Upload speeches, ask for feedback, and give feedback when someone asks you.
- **Coach** — a Member an administrator has checked out. They looked at real certificates. Coaches can leave **voice notes** and can be **found** by strangers looking for help.
- **Admin** — runs the place. Can see everything and remove anything. **Cannot write feedback**, on purpose. (Section 11 explains why.)

## The one rule that shapes everything

> **Nobody sees your speech unless you personally invite them.**

There's no public list. No "browse speeches needing feedback." No way to volunteer. You pick a person by name, and only then can they watch.

That single rule is why the system is safe, and you'll see it show up again and again in the design.

---

# 2. The big picture — four boxes

Think of a restaurant.

```
   ┌─────────────────────┐         ┌─────────────────────┐
   │   THE DINING ROOM   │◄───────►│    THE KITCHEN      │
   │                     │         │                     │
   │  What you see and   │         │  Decides what you   │
   │  click. Runs in     │         │  are allowed to     │
   │  your browser.      │         │  have. Runs on the  │
   │                     │         │  server.            │
   │  React + Redux      │         │  Laravel (PHP)      │
   └─────────────────────┘         └──────────┬──────────┘
              │                               │
              │                    ┌──────────┴──────────┐
              │                    │                     │
              │                    ▼                     ▼
              │         ┌─────────────────┐   ┌─────────────────┐
              │         │  THE RECIPE BOX │   │  THE PANTRY     │
              │         │                 │   │                 │
              │         │  Facts, lists,  │   │  The big heavy  │
              │         │  who-owns-what  │   │  stuff: videos, │
              │         │                 │   │  pictures, audio│
              │         │  PostgreSQL     │   │                 │
              │         └─────────────────┘   │  File storage   │
              │                               └────────┬────────┘
              │                                        │
              └────────────────────────────────────────┘
                    Videos go straight here — they
                    never travel through the kitchen
```

## Why four boxes instead of one?

**Because each one is good at a completely different job**, and mixing them makes all of them worse.

- The **dining room** is good at feeling fast and responsive.
- The **kitchen** is good at deciding what's allowed.
- The **recipe box** is good at answering questions like *"which speeches belong to Mars?"*
- The **pantry** is good at storing enormous things.

The old 2013 version of this project mixed them all together — the same file would decide who you were, fetch data, and print HTML all at once. That's exactly why it became impossible to finish.

## The important arrow at the bottom

Notice that **videos go straight from your browser to the pantry**, skipping the kitchen entirely.

This matters enormously. A 200 MB video going *through* the server means the server has to hold all 200 MB in memory while it passes it along — and if ten people upload at once, that's 2 GB and a dead server.

Instead, the kitchen just writes you a **permission slip** ("this person may put a file in that spot for the next 10 minutes"), and your browser does the actual carrying.

The server stays free to do its real job: deciding who's allowed to do what.

---

# 3. The front of the house — what runs in your browser

## React — the thing that draws the screen

React's one idea: **you describe what the screen should look like, and React figures out how to make it look that way.**

You never write *"find the button and change its colour to blue."* You write *"when the video is playing, this button is blue"* — and React works out what to change.

Think of a whiteboard where you write *"score: 5."* When the score becomes 6, you don't erase the whole board — you erase the 5 and write 6. React does that erasing-and-rewriting for you, and it's very good at doing the smallest possible amount of it.

**Why it matters here:** the annotation screen has notes appearing and disappearing constantly while a video plays. Doing that by hand — the 2013 way — is where bugs live.

## Redux Toolkit — the shared notebook

Different parts of the screen need to know the same things. The player needs to know which reviewer you picked. So does the sidebar. So does the note list.

Without a shared notebook, they each keep their own copy — and copies drift apart. That's the classic bug where the sidebar says one thing and the main panel says another.

**Redux is one notebook everyone reads from.** One truth, in one place.

## The rule we use for what goes where

Not everything belongs in the shared notebook. Putting too much in it is a real mistake — it makes the app slow and hard to follow.

| Where it lives | What goes there | The test |
|---|---|---|
| **RTK Query** | Anything the server decides | *"If I refresh, does the server tell me again?"* |
| **Redux slice** | Screen state that must survive | *"Is this meaningless to the server?"* |
| **React state** | Anything changing very fast | *"Would this update more than 5×/second?"* |

That last row is important. **The video's playhead position moves 60 times a second.** If that went into the shared notebook, the entire screen would try to redraw 60 times a second and the app would crawl.

So the playhead is deliberately kept out of Redux and pushed into the browser's own drawing system instead.

## What we deliberately left out

The original brief mentioned **Redux-Saga**, a library for handling complicated sequences.

We dropped it. Redux Toolkit now has a simpler built-in tool that does the same job — including the hard part, cancelling something halfway through (like an upload you abandon). Saga would have added a whole extra style of programming for no new ability.

**Redux itself stays.** Only the extra layer left.

---

# 4. RTK Query — the smart assistant

This one deserves its own section, because it does more work than anything else in the front end.

## The problem it solves

Imagine five parts of your screen all need to know *"what are Mars's speeches?"*

**Without help**, each one asks the server separately. Five identical questions. Five answers. Five copies that can disagree. And when you upload a new speech, **none of them know to update** — so you refresh the page and hope.

Then you have to write, by hand, for every single request:
- a loading spinner
- what to show if it fails
- a retry button
- a way to know the answer went stale

That's the same forty lines of code, over and over, forever. And every place you forget one is a bug.

## What RTK Query does

**It's an assistant who remembers every question you've asked and every answer you got.**

```
   Screen A: "What are Mars's speeches?"
      → Assistant: "Don't know yet. Let me ask." → asks server → remembers
      → hands answer to Screen A

   Screen B: "What are Mars's speeches?"
      → Assistant: "I already know that." → hands over the same answer
      → NO second trip to the server
```

Three things fall out of that:

1. **One question, not five.** Everyone shares the same answer.
2. **Loading and error states come free.** The assistant already knows whether it's still waiting or whether it failed. You just ask *"is it loading?"*
3. **You can't have disagreeing copies**, because there's only one.

## The clever bit — labels

Every answer gets a **label**. *"This answer is about Speeches."*

When you upload a new speech, your code says one thing: **"Speeches changed."**

The assistant then looks through everything it remembers, finds every answer labelled *Speeches*, throws those away, and **re-asks only those questions.** Every screen showing speeches updates itself. Nothing showing your profile is disturbed, because that had a different label.

```
   You upload a speech
        │
        ▼
   "Speeches changed"
        │
        ├──► answer labelled "Speeches"     → thrown away, re-asked ✓
        ├──► answer labelled "Speeches"     → thrown away, re-asked ✓
        └──► answer labelled "Profile"      → left alone
```

That's the whole idea, and it replaces an enormous amount of fiddly code.

## Why it matters *for this product specifically*

The annotation screen is the hardest screen in the app:

- a video playing
- an autosave firing every 750 milliseconds while a coach types
- several panels showing the same review at once
- a live preview that must match what the speaker will see exactly

Hand-rolling data fetching on that screen would be a swamp of race conditions — the classic one being an old, slow response landing *after* a newer one and overwriting good data with stale data.

**RTK Query handles that ordering for us.** That's not a convenience; it's a category of bug we simply never have.

## What we still had to build ourselves

Being honest: RTK Query doesn't do everything.

It has **no idea about security tokens**. Our login uses a cookie plus a security token that must be echoed back on every write. RTK Query doesn't do that automatically, so we wrote about thirty lines to handle it — including one detail that would otherwise cause an endless, baffling loop of failures.

That's written down in the plan precisely because it's the kind of thing that eats a day if you don't know.

---

# 5. The back of the house — what runs on the server

## Laravel — the kitchen

Laravel is a **framework**: a big box of pre-built parts for the things every web application needs. Logging in. Sending email. Talking to the database. Running slow jobs in the background.

**Why not build those ourselves?** Because they're solved problems, and the solved versions have been attacked by strangers for a decade and survived. Our hand-written login would not be.

The 2013 version of this project *did* hand-write all of it. It had **three different, incompatible ways of storing passwords**, and a login page that printed club passwords onto the screen for anyone to read.

## Why PHP at all?

Fair question, and the honest answer has two halves.

**The good reason:** modern PHP (version 8.4) is genuinely fast and pleasant, and Laravel is one of the best frameworks in any language. This is not a compromise.

**The honest reason:** you asked to stay in the PHP/React world, and that's a legitimate call for a project you want to own and understand. Rewriting in something unfamiliar would trade a known quantity for a novelty.

## The helpers we bolt on

| Package | What it does | Why we use it |
|---|---|---|
| **Sanctum** | Keeps you logged in | See below — this was a real decision |
| **Fortify** | Registration, password reset, email verification | Security-critical, boring, solved |
| **spatie/laravel-permission** | Roles: who's an Admin, who's a Coach | Assignment and auditing come free |
| **Filament** | Builds the whole admin panel | Saves ~1.5 weeks of tables and filters |
| **Horizon** | Watches the background job queue | Without it, slow work fails silently |

## Logging in — why not JWT?

You asked about **JWT tokens**, and the answer is worth explaining because the usual reasoning is wrong.

A JWT is like a **wristband at a theme park**. The guard checks it's genuine and waves you through — without phoning the office. That's fast.

A **session** is like a **guest list**. The guard phones the office every time: *"is Mars still allowed in?"*

JWT sounds better. It's not — **because of one thing this product does constantly: taking access away.**

Suspend a user. Remove someone's coach status. Cancel a reviewer's access. Delete an account under privacy law.

With a **guest list**, you cross the name off and it's done. **Instantly.**

With a **wristband**, you can't. The wristband is already on their arm and it's genuinely valid. You have to wait for it to expire.

### The number that settles it

Video links in this system are also temporary passes, good for 10 minutes. So the two stack up:

```
   WRISTBAND (15-minute JWT)
   0:00    Admin suspends the coach
   14:59   Their still-valid wristband gets a fresh 10-minute video link
           ← the server CANNOT refuse; refusing means checking the guest list,
              which is the exact thing the wristband existed to avoid
   24:59   That video link finally dies
   ────────────────────────────────────────
   Worst case: 24 minutes 59 seconds of watching someone's face
               after being thrown out

   GUEST LIST (session)
   0:00    Admin suspends → name crossed off
   0:00+   Next request refused. No new links can be issued.
   9:59    The last link issued before the ban expires
   ────────────────────────────────────────
   Worst case: under 10 minutes
```

**Fifteen minutes of difference**, entirely from that one choice. For a product whose content is video of a real person's face and voice, that's not a rough edge — it's an incident.

> **And when you *do* need a wristband** — a phone app someday — Sanctum does those too. Same package, no migration. "I'll need tokens eventually" is true. "So I need JWT now" doesn't follow.

---

# 6. The database — the card catalogue

## The library

Picture an old library.

There's a **card catalogue** — drawers of index cards. Each card says: title, author, date, and **which shelf the book is on.**

Then there are **the shelves**, with the actual books.

- The **card catalogue** is the database.
- The **shelves** are file storage.

**The books are not in the catalogue.** The catalogue only says where they are.

## Why the videos aren't in the database

This is the single most important thing to understand about the design, and it's worth being able to explain properly.

### Reason 1: You couldn't scrub. This one alone decides it.

Your whole product is dragging a scrubber around a video. That works because a browser can say *"give me bytes 40,000,000 through 41,000,000"* and get exactly that slice back.

A filesystem does that natively. It's a seek and a read — microseconds, almost no memory.

**A database has no equivalent.** To serve that slice from inside a database you'd pull the entire 200 MB into memory and cut a piece out. Every scrub. For every viewer.

**For a video-annotation product, that's disqualifying on its own.** The feature you're building *is* seeking.

### Reason 2: It poisons the memory that makes the database fast

A database keeps its most-used data in fast memory. That's most of why it's quick.

Reading one 200 MB video would shove out an enormous amount of genuinely useful data. So watching a video would make **every unrelated part of the site slower**, for everyone, until the memory refilled.

### Reason 3: Every copy pays for it

Backups. Restores. Copies for testing. All of it moves gigabytes instead of megabytes. A nightly backup goes from seconds to hours.

### Underneath all three

**A video has no relationships, no rules to enforce, and nothing to search.** You can't sort by "the third byte." It's an opaque lump.

Putting it in a database means paying for machinery — indexing, transactions, locking, caching — that the lump can't use. All cost, no benefit.

> **The rule, in one line:**
> **The database holds what *describes* the speech. The disk holds the speech.**

### What it costs us

Being fair: splitting them isn't free. Writing a row and writing a file aren't one action, so one can succeed while the other fails.

We handle it deliberately: the row is written **first**, marked *uploading*, and only becomes *ready* once the file is confirmed. A nightly sweep cleans up both directions — files with no row get deleted, rows stuck mid-upload get failed.

Cost: about forty lines of code and one scheduled job. Against the three problems above, a good trade.

## Why PostgreSQL and not MySQL

The original plan said MySQL without ever explaining why. It was inherited from the 2013 project — an unexamined default. We changed it, and here's the plain-language version.

### It says what it means

We have several rules like *"a speech can have only one main thumbnail."*

**In MySQL** you can't say that directly. You have to use a trick: create an extra hidden column that's `1` when something is the main one and *blank* otherwise, then rely on the fact that MySQL doesn't compare blanks to each other. It works. It's also baffling to read, and the plan needed a whole paragraph defending it.

**In PostgreSQL** you write the rule as a sentence: *"this must be unique — but only count the rows where it's the main one."* Done.

We used that trick in **four places**. All four get simpler.

### It removed the riskiest piece of the whole design

One of those four was worse than the others. It was a hidden column whose definition encoded a set of rules that don't exist until halfway through the build — so we'd be writing a **guess** into the database structure in week 3, and changing it later means rebuilding the entire table.

In PostgreSQL that column doesn't need to exist at all. **The most dangerous part of the schema stopped being dangerous by switching database.**

### It's safer when things go wrong

There's a lock protecting the rule *"you can't delete the last administrator."* In MySQL, if the program crashes at the wrong moment, **the lock can get stuck**, and someone has to clear it by hand. PostgreSQL releases it automatically no matter how things end.

### What it cost us

One real thing. MySQL was quietly treating `MarsCheung`, `marscheung` and `märscheung` as **the same name** — which blocks a nasty impersonation trick, for free.

PostgreSQL doesn't do that by default. So we now do it ourselves when saving a username. Half a day of work, and it's on the checklist as a test.

### When to decide

**Now — and only now.** There's no data yet and no code yet, so switching is a find-and-replace in a document. After a few months of building, it's a rewrite.

---

# 7. The schema — the shape of the information

A **schema** is just the list of what facts we store and how they connect. Here it is, small enough to read.

```
   USER  ─────owns─────►  SPEECH  ─────has─────►  VIDEO FILE
     │                       │                    THUMBNAIL
     │                       │                    CAPTIONS
     │                       │
     │                       ▼
     └──is the reviewer──► REVIEW  ─────holds───►  ANNOTATIONS
                             │                     (the timed notes)
                             │
                             └─────also holds───►  THE ESSAY
```

## The one big idea: `REVIEW`

Everything hangs off this one, and it's worth understanding because it's the decision the whole design rests on.

**A review is one person's involvement with one speech.** It is *four things at once*:

1. **The invitation** — "Mars asked Jordan to review this"
2. **The permission slip** — Jordan may watch this speech, and only this speech
3. **The folder** holding all of Jordan's timed notes
4. **The essay** Jordan wrote

### Why bundle them?

Because they're the same thing wearing four hats. They're created together, they change together, and they'd be deleted together.

An earlier version of the plan split them into separate tables. That was a mistake, and here's exactly why: **nothing stopped a note from existing with no invitation behind it.** The rule "you can only annotate what you were invited to" was written in a document, but the database itself didn't enforce it.

Now a note **must** point at a review. There's no way to create an orphan note. The rule isn't a policy anyone can forget — **it's the shape of the data.**

> **That's the recurring theme of this whole design:** wherever possible, make the wrong thing *impossible to represent* rather than *forbidden by a rule*.

### The proof it was the right shape

Halfway through, the requirements changed: reviewers no longer had to be coaches — anyone could be asked.

**That change cost one renamed column.** `coach_id` became `reviewer_id`, and every rule kept working.

A requirement that generalizes a design by renaming one thing is evidence the design was cut along the right joint.

## Two rules the database enforces by itself

**One review per person per speech.** You can't accidentally end up with two folders for the same person. This also quietly solves a race: if someone double-clicks Accept, the second one collides and we just hand back the first.

**A speech can only replace an older speech.** Every speech gets a number, always counting up. A speech may only point at one with a *lower* number.

That sounds small. It means **you cannot create a loop** — A replaces B replaces A — because that would need A both lower and higher than B. The check is five words and it removes a whole category of bug.

## What we deliberately don't store

- **No "public" setting on a speech.** Every speech is private. Full stop. An earlier draft had one, and it would have been a hole straight through the main rule.
- **No note ordering column.** Notes sort by their timestamp. Storing a separate order would mean re-numbering everything each time someone nudged a note half a second.
- **No discussion threads.** Nice idea; nobody asked for it; half-designed features are how the 2013 version died.

---

# 8. The video pipeline — from your phone to the screen

## The four stages

```
   1. UPLOAD ──► 2. INSPECT ──► 3. CONVERT ──► 4. WATCH
```

### 1. Upload — the permission slip

Your browser asks the server: *"I'd like to upload a video."*

The server writes a **permission slip**: *this person may put a file in this exact spot, for the next 10 minutes, and nothing else.*

Your browser then uploads **directly to storage**. The server never touches the bytes.

The file goes in **chunks**, which is why you can lose your wifi halfway and resume — only the unfinished chunk is redone.

### 2. Inspect — what did we actually get?

We look inside: what format, how big, how long, is it sideways?

**Why this matters:** iPhones record in a format many browsers can't play. If we just accepted the file and hoped, roughly half of all uploads would silently not work.

### 3. Convert — only when needed

Two paths:

- **Already fine?** We just re-wrap it — moving one small piece of bookkeeping to the front so playback can start before the whole file arrives. Takes about a second.
- **Not fine (iPhone, huge, sideways)?** Full conversion. Minutes.

We check first because **most files don't need converting**, and pretending they all do would make every upload slow.

The tool for this is **FFmpeg** — the same thing that quietly powers most video on the internet.

> **A licensing note worth knowing:** FFmpeg built with the good video encoder carries obligations if you *distribute the program*. Running it yourself is fine. So it lives in its own sealed box that we never publish. Costs nothing, removes the question entirely.

### 4. Watch — another permission slip

When you press play, the server checks you're allowed, then writes another temporary pass — good for 10 minutes.

**Why only 10 minutes?** So a leaked link dies quickly. If someone posts it in a chat, it's useless almost immediately.

Ten minutes is also longer than most people watch in one go, and when it expires mid-video, the player quietly fetches a new one.

## Thumbnails, and one trap worth knowing

We grab a still frame for the list view — taken at **10% into the video**, never the very start, because the first seconds are usually an empty lectern.

**The trap:** the command to jump to a point in a video accepts the same instruction in two positions, and they behave completely differently. One jumps straight there. The other **decodes every single frame** up to that point first.

On a 40-minute video that's the difference between **80 milliseconds and 30 seconds.**

It's the most common mistake in thumbnail code, and it's in the plan so nobody makes it.

---

# 9. Whisper — the robot that listens

## What it is

**Whisper listens to a recording and types out what was said.**

That's it. Audio in, text out.

It was made by OpenAI and released free, and there are free versions anyone can run on their own machine. We use one of those — **not a paid service, not an internet API.** It runs in a box on our own server.

## What we use it for — two jobs

### Job 1: Captions

Every speech gets automatic subtitles.

**Why this isn't optional:** this is a product for learning to speak. A person who is deaf or hard of hearing **cannot use it at all** without captions. Not "it's harder" — cannot use it.

The speaker can fix mistakes, because voice recognition on a nervous first-time speaker is imperfect, and **a wrong transcript you can't correct is worse than none.**

### Job 2: Making voice notes survivable

This one is less obvious and more important.

Coaches can record spoken notes. Now — everyone has the right to delete their account and have their personal data removed.

Our whole approach to that is: **keep the words, drop the name.** Your feedback stays useful to the person you gave it to; your identity disappears.

**But a recording of a voice can't be split like that.** The voice *is* the identity. There's no way to anonymize it.

So without transcripts, **one coach deleting their account would destroy every spoken note they ever left** — for every speaker, going back forever.

With a transcript, deletion removes the audio and keeps the words. The system's promise still holds.

> **That's the real reason transcripts are mandatory** — stronger than the accessibility reason, and it's a reason most people would never think of until it was too late to add.

## Why run it ourselves?

**Money.** Transcription services charge per minute of audio. Self-hosted, it's free forever.

**Privacy.** These are recordings of identifiable people. Not sending them to a third party is a genuinely better position — legally and ethically.

## What it costs us

Honesty matters here.

**It's slow.** On an ordinary processor, transcription takes minutes — sometimes longer than the video itself.

**It's heavy.** The container needs several hundred megabytes of model files.

**How we handle it:** Whisper gets **its own separate queue.**

```
   Upload
     │
     ├──► VIDEO QUEUE   ──► convert ──► READY TO WATCH (seconds)
     │
     └──► CAPTION QUEUE ──► transcribe ──► captions arrive later
```

If both shared one queue, a two-second video conversion would sit behind a five-minute transcription, and every upload would *feel* like it took five minutes.

**Split, you can watch your video almost immediately** and captions catch up.

That's also why the Whisper box doesn't arrive until step 9 of 16 — no point running the heaviest thing on your laptop for four months before you need it.

---

# 10. The annotation engine — the heart of the product

This is the actual feature. Everything else exists to support it.

## What it has to do

A video is playing. There's a list of notes, each with a start time and a duration. **The right notes must be on screen at the right moment**, fading in and out, even when you drag the scrubber backwards.

## How it works

The browser has a **built-in system for timed text** — the thing that shows subtitles. We use it, because it's built into the browser, it's precise, and it's free.

But we don't *trust* it completely — some browsers are unreliable with it.

So we run a **second, simple check four times a second**: *"given the current time, which notes should be visible?"*

That check is a tiny, pure piece of arithmetic. Given a time and a list, it returns a set. No video involved.

```
   Browser's subtitle system ──┐
                               ├──► which notes are visible now?
   Our own check, 4×/second ───┘
```

**Two independent sources.** If the browser's version is late or misses one, ours catches it within a quarter-second.

## Why this design is a big deal

The tiny arithmetic function can be **tested without a browser at all.**

We can throw thousands of awkward cases at it in milliseconds — notes at exactly zero, overlapping notes, negative times, nonsense values — and know it's correct.

Browser tests are slow and flaky. **Arithmetic tests are instant and certain.** By pushing all the *thinking* into arithmetic, we made the hard part cheap to prove.

## Voice notes — a different shape

Spoken notes don't fade in. **They interrupt.**

```
   video playing ──reaches 2:30──► video PAUSES
                                        │
                                   voice note plays
                                        │
                                   note ends ──► video RESUMES
```

### Why this is better than the obvious alternative

The obvious version is playing the coach's voice *over* the speech. We investigated it properly and found **two problems with no good solution**:

1. **The browser tool for mixing audio goes silent** when the video comes from a different address than the page — which ours does, by design. You can't detect it in advance, and you can't undo it.
2. **On iPhones, you cannot turn the video's volume down at all.** Apple reserves that for the physical buttons. So there'd be no way to make the coach audible over the speech.

The interrupt version **has neither problem** — only one thing plays at a time.

And it's arguably the better product anyway: **a coach sitting next to you doesn't talk over the video. They hit pause and talk.**

It also cost 2 weeks instead of 4.5.

## Six small rules that took real thought

1. A note fires when playback **crosses** its time going forward. Dragging the scrubber to the end must not trigger twelve notes at once.
2. Scrubbing backwards **re-arms** it, so "watch that bit again" works.
3. **If you pause manually, it stays paused.** Overriding a deliberate pause is the single most irritating thing this feature could do.
4. **Skip is always available.** On your fifth rewatch you don't need the commentary again.
5. **A marker warns you a pause is coming**, so it doesn't look like the video froze.
6. **The transcript shows on screen** while it plays, so it works with the sound off.

Each of those is a bug if left unsaid.

---

# 11. Who can see what

## The one rule again

> **Nobody sees your speech unless you personally invited them.**

There is no browsable list. Nobody can volunteer. **The only way** a permission slip exists is if the speech's owner named a person.

## Why we removed the open list

An earlier draft had a public pool of speeches wanting feedback, and coaches could claim one.

Then the requirement changed so *anyone* could review. Combined, that would have meant:

> Someone signs up, opens the list, clicks Accept, and is **now watching a video of a stranger's face and voice.** Nobody approved them. They approved themselves.

That's the worst possible hole, and it would have been **on purpose**.

Removing the list entirely fixes it in a way a rule can't: **self-granting access isn't blocked, it's impossible to express.**

## Reviewers can't see each other

If three people review your speech, **none of them can see the others' notes** — and none of them can even tell the others exist.

**Why hide the count too?** Because "three people are reviewing this" tells a reviewer their opinion isn't the only one, and that quietly changes what they write. Independent assessments have to actually be independent.

## Admins moderate. They don't participate.

Admins can see everything and remove anything. **They cannot write feedback at all.**

This was your instruction, and it removed a genuine problem. Earlier, admins *could* write feedback — which created a loophole:

> Want to read what other coaches said about someone? **Just add one throwaway note of your own.** Now you're "an admin viewing a speech" rather than "a reviewer peeking at peers." Same access, different label.

The first fix was a rule: writing feedback costs you your moderator view of that speech. It worked, but it was a rule to remember, a warning dialog, and a permission that vanished mid-session.

**Removing the ability deletes all of it.** A moderator who has written an assessment of the work they're moderating is compromised whatever the rules say. Removing the capability removes the question.

## What happens when you delete your account

Handled in a strict order: log out everywhere → delete video files → delete voice recordings → delete speeches → **remove your name from feedback you wrote, but keep the words** → delete your profile → scramble the account.

**Why keep the words?** Because the feedback you gave belongs to the person you gave it to. They relied on it. Your *name* is yours; the *help* was theirs.

The one exception is voice recordings — which is exactly why transcripts are mandatory (Section 9).

---

# 12. Containers — the matching lunchboxes

## The problem

Software needs specific versions of specific things. "Works on my machine" is a joke because it's usually true and useless.

## The idea

A **container** is a sealed box holding the program *and everything it needs.*

Like a lunchbox packed with the sandwich, the drink, the napkin — hand it to anyone anywhere and it's the same lunch.

## Our boxes

| Box | Job |
|---|---|
| `app` | The kitchen — Laravel |
| `web` | The front desk — serves pages, hands out files |
| `postgres` | The card catalogue |
| `valkey` | The to-do list for background work |
| `queue-worker` | Does the background work |
| `ffmpeg-worker` | Converts videos |
| `whisper` | Listens and types |
| `seaweedfs` | The pantry |
| `mailpit` | Catches emails while developing |
| `clamav` | Scans uploaded PDFs for viruses |

## One box at a time

Since you're learning Docker, they arrive **one per step** rather than all at once.

**Three on day one; ten by the end.** The first configuration file is short enough to read in full, and every addition teaches exactly one new idea:

- **Step 03** adds two boxes *from the same image with different instructions* — the clearest illustration of what an image actually is.
- **Step 09** adds the huge Whisper model files, teaching why you *mount* big files rather than baking them in.
- **Step 12** adds a virus scanner that's slow to start, which is where "wait until it's actually ready" stops being optional.

## Why not the easy shortcut?

Laravel ships a tool that generates all this automatically. **We deliberately don't use it** — because it hides everything, and you said the point was to learn.

Use it as a *reference* — generate it, read it, then delete it and write your own.

---

# 13. Growing up — what happens when it gets big

## Today's honest size

**One machine.** That's it, and that's correct — building for millions of users you don't have is the classic way to never ship anything.

## What we did anyway, because it's free now and expensive later

| Decision | Why it matters at scale |
|---|---|
| **Nothing is stored on the app's own disk** | Add a second machine without moving anything |
| **The app remembers nothing between requests** | Any machine can serve any request |
| **All file access goes through one function** | Swap to Amazon or Cloudflare by changing settings |
| **Every list is paginated from day one** | Adding it later breaks every app already reading the old format |
| **Every "find one thing" has an index** | Retrofitting indexes means finding every slow query first |
| **Slow work already runs in the background** | The separation that lets you move it to its own machine |

None of that slows us down now. All of it would be painful to retrofit.

## What we deliberately did *not* build

This list is as important as the other one.

**No caching of "can this person see this?"** — this is the one that sounds smart and is actually dangerous. Caching permissions means someone you just banned keeps getting in until the cache expires. **Never cache permissions.**

**No live updates** — the design shows a *published snapshot*, not a live stream, so there's nothing to push.

**No microservices, no Kubernetes, no splitting the database.** All of that solves problems we don't have and creates several we don't want.

## The honest weak point

**The video converter doesn't scale.** It handles one video at a time on one machine.

If this ever gets real traffic, **that's the first thing you'd pay for.** Better to say so plainly than to pretend the architecture is infinitely elastic.

The good news: it's already isolated in its own box behind a clean boundary, so replacing it is a swap, not a rewrite.

## The realistic path if it grows

```
   Now         One machine, everything on it
    │
    ▼
   10× users   Move background workers to their own machine
    │          (already separated — this is a config change)
    ▼
   100×        Add a second app machine behind a load balancer
    │          (already stateless — this just works)
    ▼
   1000×       Buy video conversion from someone else
               Move files to a CDN
               Add a read-only copy of the database
```

**Every one of those is a change of settings, not a rewrite.** That's what "architected for later scale" actually means — not that it's fast today, but that nothing has to be undone.

---

# 14. The money question

## What it costs to run: $0 per month

Everything is free and self-hosted. Video conversion, transcription, storage, error tracking, uptime monitoring — all free software on your own machine.

The only real costs: **a domain name (~$15/year)**, and eventually **email**, if you send more than a few hundred a day.

## What $0 actually costs you

Being straight about this, because it isn't free — it's paid in time instead of money.

| You save | You pay |
|---|---|
| ~$40/month in services | ~2 extra weeks building the video pipeline |
| No vendor lock-in | You own it when it breaks at 2am |
| No per-minute transcription bill | Transcription is minutes, not seconds |
| Full control of the data | No adaptive quality, no global CDN |

> **Worth stating plainly:** at this scale, the *build* costs more than a decade of hosting would. Self-hosting saves maybe $40/month and costs 1–2 weeks.
>
> **That's a fine trade if you want to own and understand the stack** — which is a legitimate goal for this project. It is not a cost optimization, and it shouldn't be justified as one.

## The one place free isn't your choice

**Email.** You can run your own mail server, but the big providers will send your mail to spam by default, because unknown senders are how spam works.

And email now matters more than it used to: **a verification email in the spam folder is an account that never activates.** So use a free tier from a real provider and keep it swappable.

---

# 15. One-page cheat sheet

*For when someone asks and you have thirty seconds.*

## What it is

A speech-coaching platform. You upload a video of yourself speaking, invite specific people to review it, and their feedback appears **anchored to the exact moments it's about** — fading in and out as you rewatch. Some feedback is spoken: the video pauses, you hear their voice, then it continues.

## The stack, and one line for each

| Layer | Choice | Because |
|---|---|---|
| Screen | **React** | Describe what it should look like; it works out the rest |
| Shared state | **Redux Toolkit** | One truth, not five copies that drift apart |
| Server data | **RTK Query** | Asks once, remembers, and knows what went stale |
| Server | **Laravel (PHP 8.4)** | Login, email, queues — solved, and battle-tested |
| Login | **Sanctum sessions** | You can revoke a session **instantly**. A token you cannot. |
| Database | **PostgreSQL** | Says what it means; removed the riskiest part of the schema |
| Files | **Object storage** | Videos need seeking; databases can't seek |
| Video | **FFmpeg** | Free, and runs most video on the internet |
| Speech-to-text | **Whisper** | Free, private, and makes deletion possible |
| Packaging | **Docker** | Same setup everywhere — and you wanted to learn it |

## The five ideas that shape everything

1. **Nobody sees your speech unless you invited them personally.** No public list, no volunteering.
2. **Make wrong things impossible, not forbidden.** A note can't exist without an invitation behind it — not because a rule says so, but because the data has no shape for it.
3. **Videos never travel through the server.** Permission slips, not deliveries.
4. **Reviewers can't see each other**, including *that* each other exists.
5. **Admins moderate; they don't participate.** Removing the capability removed the loophole.

## Three answers to the hard questions

**"Why not JWT?"**
> Everything sensitive here is *taking access away*. A token's one advantage — not having to check with the server — is exactly what makes revocation impossible. Concretely: **25 minutes of continued access after a ban, versus under 10.**

**"Why not put videos in the database?"**
> Your whole product is scrubbing through video. That needs byte-range seeking, which a filesystem does natively and a database can't do at all. Plus one video read would evict the memory that makes every other query fast.

**"Does this scale?"**
> One machine today, honestly. But nothing is stored locally, the app remembers nothing between requests, and slow work is already separated — so growing is a config change, not a rewrite. **The one thing that genuinely doesn't scale is video conversion, and that's the first thing you'd buy.**

## The timeline

**34–41 weeks** to production-ready, in **16 steps** — and **15 of the 16 end with something you can open in a browser and use.** The first working thing arrives in **week 3**.

---

*Full technical detail: [MODERNIZATION_PLAN.md](MODERNIZATION_PLAN.md). Build order and per-step demo scripts: [STEPS.md](STEPS.md).*
