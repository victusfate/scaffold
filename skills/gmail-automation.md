## Purpose

Automate Gmail without the desktop web interface: create labels, tag existing
mail by sender/domain/subject, set up filters that tag future mail, and query or
tidy the inbox through agent tools, the Gmail API, or scripts.

Example: auto-tag everything `from:tekhorizons.com` with `projects/voidhorizon`.

## When to Use

- Setting up email filters, rules, or automatic labeling criteria.
- Auto-tagging incoming email by sender, domain, or subject.
- Processing, querying, or managing inbox messages via API, CLI script, or agent tool.

## Rules

1. **Bypass the web UI.** Never tell the user to open Gmail's settings menu. Do
   the work with tools, the API, or a script. If no available route can do a
   step (see *Filters* below), say exactly which step is blocked and why; do
   not fall back to "click Settings → Filters".
2. **Confirm the account first.** A connector or token is bound to exactly one
   account, and users often have several. Before any change, name the account
   you're acting on and confirm it's the one the user means. To see which account
   a connector is on, check the `to:`/`deliveredto:` address in a recent
   `search_threads` result. If the user means a different account, don't act
   through this connector: use that account's own API token (see *Filters via
   the Gmail API*) or ask the user to connect it. A label missing from one
   account says nothing about the others.
3. **Resolve labels before acting.** Label tools take label **IDs**, not names.
   Call `list_labels` on the confirmed account and match the exact `name`.
   Never guess a name from the user's wording: `A Code Projects/foo` and
   `projects/foo` are different labels. If the label is missing in that
   account, confirm the exact path with the user, then create it (nested paths
   use `/`).
4. **Preview before bulk changes.** Run the search, report the match count and a
   few sample senders/subjects, then apply. Get confirmation before touching
   more than ~50 threads, or before any trash/spam/archive action.
5. **Report what changed.** Name the account and state counts from the
   tool results (threads labeled, filter id created). A filter that wasn't
   created is "not created", not "set up".

## Routes by harness

| Capability | Claude (Gmail connector) | Gmail API script (any harness) |
|---|---|---|
| List / create labels | `list_labels`, `create_label` | `users.labels.list` / `.create` |
| Search mail | `search_threads` (Gmail query syntax) | `users.threads.list?q=` |
| Tag existing mail | `label_thread`, `label_message`, `update_message_labels` | `users.threads.modify`, `users.messages.batchModify` |
| Untag / archive / mark read | `unlabel_thread` (remove `INBOX` / `UNREAD`) | `users.threads.modify` |
| **Filter for future mail** | **not available in the connector** | `users.settings.filters.create` |

In Claude Code the connector tools are deferred: load them with `ToolSearch`
(e.g. `select:mcp__Gmail__list_labels,mcp__Gmail__search_threads,mcp__Gmail__label_thread,mcp__Gmail__create_label`)
before calling. If no `mcp__Gmail__*` tools exist, the Gmail connector isn't
connected: tell the user to connect it in their claude.ai connector settings,
or use the API script route.

## Workflow: auto-tag by sender

1. **Confirm the account, then resolve the label.** `list_labels` → find the `labelId` whose `name`
   exactly matches. Missing → confirm the path, then `create_label` with
   `displayName: "<parent>/<child>"`.
2. **Backfill existing mail.** `search_threads` with `query: "from:tekhorizons.com"`
   (`pageSize: 50`, follow `pageToken` until exhausted). Skip threads whose
   preview `labelIds` already include the target. For each remaining thread,
   `label_thread` with `labelIds: [<labelId>]`. Thread labels also apply to
   later replies in that thread.
3. **Cover future mail with a filter.** The connector cannot create filters, so
   use the Gmail API (next section). Without API credentials, report that
   existing mail is tagged and future mail is **not** until the filter exists,
   or offer a recurring backfill (`/loop` running step 2 with
   `newer_than:2d`) as a stopgap.
4. **Verify.** `search_threads` with `from:tekhorizons.com -label:<name>` (spaces
   and `/` in the name become `-`, e.g. `label:projects-voidhorizon`) should
   return nothing. Report the counts.

## Filters via the Gmail API

Creating filters needs an OAuth token with the
`https://www.googleapis.com/auth/gmail.settings.basic` scope (labeling needs
`gmail.modify`). Tokens are per account: for multiple accounts, keep one token per
address (e.g. a token file per account) and pick the one for the confirmed account.
Check for existing credentials first (an env var or a token file the user
names). Never ask the user to paste secrets into chat, and never commit them.

```bash
# TOKEN: OAuth access token with gmail.settings.basic; LABEL_ID from list_labels
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://gmail.googleapis.com/gmail/v1/users/me/settings/filters \
  -d '{"criteria":{"from":"tekhorizons.com"},"action":{"addLabelIds":["'"$LABEL_ID"'"]}}'
```

- `criteria` fields: `from`, `to`, `subject`, `query` (full Gmail search syntax),
  `negatedQuery`, `hasAttachment`, `size` + `sizeComparison`.
- `action` fields: `addLabelIds`, `removeLabelIds` (e.g. `["INBOX"]` to skip the
  inbox, `["UNREAD"]` to mark read), `forward`.
- List existing filters first (`GET .../settings/filters`) and skip duplicates;
  the API creates identical filters without complaint.
- Filters apply only to mail arriving after creation; always pair with the
  backfill step.

For a reusable script, prefer the repo's default language (see
`.agent/default-language.md`) with the official Google client library over raw
`curl`.

## Gotchas

- `search_threads` previews show only the ~5 oldest messages per thread; call
  `get_thread` before reasoning about the latest message.
- `label:` in search matches the display name, never the `Label_…` ID.
- `DRAFT` and `SENT` are read-only system labels.
- Category tabs are `CATEGORY_*` labels; adding one moves the thread to that tab.
- Use `trash_thread` / `mark_thread_spam` for trash and spam, not label tools.
