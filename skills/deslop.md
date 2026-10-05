## Purpose

> **Multi-harness:** This skill references other scaffold skills using slash-command notation (`/name`). In **Claude Code** and **agy**, slash commands auto-expand from their skill/workflow directories.
> Under **Codex** (`$name` or `/skills`) and **pi**, read and follow `.agents/skills/<name>/SKILL.md` instead. The canonical instructions in `skills/<name>.md` are identical for all harnesses.

Check prose for AI-slop patterns and fix them while keeping the writer's voice.
Targets: PR titles and bodies, commit messages, `design.md` / `prd.md`, READMEs,
docs, release notes, and any draft the user pastes. It also enforces the AGENTS.md
*Veracity* rule against self-labels like "honest", "to be clear", "frankly".

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

## Scope guard

Only prose changes. Leave untouched: fenced code blocks, inline code, identifiers,
file paths, command lines, URLs, quoted error output, table cells holding data, and
anything inside a template the caller requires verbatim (e.g. the `/create-pr`
section headings). If unsure whether a span is prose, leave it.

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
- **Em dashes.** None in short copy; one or two in long text when they beat a comma or period.

## Workflow

1. Read the whole text. Identify its job, its reader, and the voice traits to keep.
2. Detect mode: list findings as `pattern — "quoted line" — fix`, then stop.
3. Edit mode: apply the minimum edits within the scope guard.
4. **Self-check** the result; fix and re-check until every answer is yes:
   - Same meaning, no added claims, numbers, or sources?
   - Would the writer recognize it as their own voice?
   - No banned words, self-labels, or listed patterns left (outside quotes and code)?
   - Code, paths, identifiers, and required template headings unchanged?
   - Ends on a concrete point, not a recap or kicker?
5. Output the edited text (or write the file) and the **What changed** list.

## Called from other skills

- `/create-pr` Step 6 runs `/deslop` in edit mode on the drafted title and body
  before the PR is created. It keeps the template headings and the Quality Scores
  and gate tables exactly as drafted.
