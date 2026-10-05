## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

Make user-facing writing sound like a person wrote it, and strip filler from
engineering docs without losing any of their substance. It also enforces the
AGENTS.md *Veracity* rule against self-labels like "honest", "to be clear",
"frankly".

The goal is readable text, not shorter text. Removing a step, a caveat, or a
reason to save words is a failure, even when the result reads more smoothly.

Adapted from [petergyang/no-ai-slop](https://github.com/petergyang/no-ai-slop) (MIT).

## Two modes

**Edit (default).** Make the minimum effective edit using the rules below. Return
the full edited text, then a short **What changed** list.

**Detect.** Used when the user asks to audit, scan, or flag text without rewriting,
or when another skill asks for findings only. For each hit: name the pattern,
quote the line, give the fix in a few words. Do not rewrite, score the text, or
guess whether AI wrote it. Pattern names are evidence the reader can check;
"sounds like AI" is not.

Invocation: `/deslop` (edit the text in context), `/deslop <path>` (edit that file
in place), `/deslop --detect <path>`.

## Pick the pass by content type

Decide which kind of text this is before editing. When a file mixes both, apply
each pass to its own sections.

| Content | Examples | Pass |
|---|---|---|
| **User-facing** | README intro and "why", release notes, changelog entries, landing or marketing copy, UI strings, emails, announcements, PR Summary bullets | **Full rewrite** in plain language (rules below) |
| **Engineering reference** | `design.md`, `prd.md`, `plan.md`, AGENTS.md, skill bodies, API docs, runbooks, architecture notes, code comments, install and config steps | **Filler-only pass**: remove banned words, self-labels, and throat-clearing. Do not restructure, shorten, or rephrase technical sentences. When unsure, list findings (detect mode) instead of editing |

### Never lose engineering content

In either pass, **never delete, merge away, or soften** any step, command,
constraint, caveat, edge case, number, default, version, error message, warning,
rationale ("because…"), or example. Keep normative words exactly as written:
MUST, NEVER, SHOULD, "only", "always", "do not". Keep tables, lists, and headings
that carry structure. If a sentence is both filler-shaped and carries a fact,
keep the fact and drop only the filler around it.

**Terms of art are not slop.** "Harness", "robust estimator", "leverage ratio",
"seamless roaming" and similar terms with a specific technical meaning stay. A
word on the banned list is only banned when it is decoration.

## Scope guard

Only prose changes. Leave untouched: fenced code blocks, inline code, identifiers,
file paths, command lines, URLs, quoted error output, table cells holding data, and
anything inside a template the caller requires verbatim (e.g. the `/create-pr`
section headings). If unsure whether a span is prose, leave it.

## Plain language for user-facing text

Write it the way you would explain it to a smart friend who doesn't work on the
project:

- Say what it does for the reader first, then how. "Your PRs open with tests
  already run" beats "Automated pre-merge validation pipeline".
- Use plain words: "use" not "utilize", "help" not "facilitate", "start" not
  "initialize" (unless it's the command name).
- Address the reader as "you". Name who does what.
- Define jargon the first time, or replace it. Keep a technical term when the
  reader will need it later (a command, a setting name).
- Short sentences are fine; so is a long one that reads naturally out loud.
- Keep real enthusiasm, but show it with a concrete detail, not adjectives.

## Editing rules

- **Preserve the writer's voice.** Before editing, note vocabulary, cadence,
  bluntness, humor, and level of polish. Keep what is personal. Do not make every
  paragraph equally tidy.
- **Minimum effective edit.** Fix slop, errors, and repetition. Leave strong
  sentences alone. A rough draft should still sound like the same person.
- **Never invent.** No new claims, numbers, examples, sources, or opinions. If a
  claim needs a source the text does not have, flag it for the user.
- **Lead with the point** when the setup adds nothing.
- **Concrete over abstract.** "Cut deploy time from 40 to 4 minutes" beats
  "improved efficiency". Keep the specific fact; do not smooth it into importance.
- **Portability test.** A sentence that could move unchanged to another product or
  project is filler. Cut it or make it specific.
- **Active voice, direct verbs.** "Made a decision" → "decided". "Has the ability
  to" → "can".
- **Show, don't label.** Cut lines that tell the reader something is important,
  surprising, or obvious; let the fact carry it.

## Words to cut

Banned unless quoted as an example: delve, foster, leverage, utilize, facilitate,
empower, streamline, robust, cutting-edge, seamless, paradigm shift, game changer,
tapestry, realm, beacon, multifaceted, meticulous, intricate, paramount,
transformative, elevate, embark, supercharge, harness (as a verb), ever-evolving.

Self-labels (AGENTS.md *Veracity*): honest, honestly, to be honest, the honest
truth, transparent(ly), to be clear, frankly. Delete them and let the evidence
stand. Keep one only when it marks a real reversal of an earlier claim.

Often-empty adverbs, cut when they add nothing: just, literally, simply, actually,
truly, fundamentally, importantly, crucially, inherently.

Often-empty phrases: it's worth noting, it's important to note, at the end of the
day, when it comes to, at its core, in today's world, the reality is, in terms of,
in order to, going forward, let's dive in.

## Patterns to cut

The patterns below are defaults, not overrides. A deliberate phrase in the
writer's voice (a tagline, a joke, a punchy heading like "scored, not vibed")
stays even when it matches a pattern; cut only the ones that read as autopilot.

- **Binary contrasts.** "It's not X, it's Y." / "Not just X but Y." → state Y.
- **Throat-clearing openers.** "Here's the thing", "Let me be clear" → cut.
- **Faux-insight setups.** "What most people miss", "Here's what nobody tells you" → make the claim.
- **Colon reveals.** "The best part: it learns." → a plain sentence.
- **Superficial -ing tails.** "…, highlighting the team's commitment to quality" → the concrete consequence, or cut.
- **Importance puffery.** "Marks a pivotal moment", "plays a vital role" → the fact.
- **Weasel attribution.** "Studies show", "experts agree" → name the source or flag it.
- **Metadiscourse.** "The key point is", "As you can see", "This distinction matters" → cut.
- **Negative listing / dramatic fragments.** "Not a X. Not a Y. A Z." / "That's it. That's the whole thing." → full sentences.
- **Synonym cycling.** Repeat the right word; don't rotate agent/assistant/tool for variety.
- **Kickers and recaps.** Delete a closing aphorism or "In conclusion…" paragraph; end on the last concrete point or next action.
- **Formatting slop.** Emoji headings, bold scattered mid-sentence, bullets that should be two sentences, headers over two-line sections.
- **Em dashes.** None in short copy; one or two in long text when they beat a comma or period. A dash used consistently as a
  list-label separator ("**Label** — text") is house style, not slop.

**Keep house style.** Match the document's existing conventions: list-label
style, heading case, bullet punctuation, spelling. Never change a convention in one
section and not the rest; if a convention itself is the problem, flag it instead.

## Workflow

1. Read the whole text. Identify its job, its reader, and the voice traits to keep.
   Pick the pass for each section (user-facing or engineering reference).
2. Detect mode: list findings as `pattern — "quoted line" — fix`, then stop.
3. Edit mode: apply the minimum edits within the scope guard.
4. **Self-check** the result; fix and re-check until every answer is yes:
   - Same meaning, no added claims, numbers, or sources?
   - Would the writer recognize it as their own voice?
   - No banned words, self-labels, or listed patterns left (outside quotes and code)?
   - Code, paths, identifiers, and required template headings unchanged?
   - Every step, command, constraint, caveat, number, and MUST/NEVER rule from
     the original still present? Compare the two side by side. If anything was
     lost, put it back.
   - Ends on a concrete point, not a recap or kicker?
5. Output the edited text (or write the file) and the **What changed** list.

## Called from other skills

- `/create-pr` Step 6 runs `/deslop` in edit mode on the drafted title and body
  before the PR is created. The Summary bullets get the user-facing pass; the Test
  plan gets the engineering pass. Template headings and the Quality Scores and gate
  tables stay exactly as drafted.
