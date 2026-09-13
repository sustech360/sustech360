# Data model

Declared in `apps-script/Schema.gs`. Column order is data, not layout: nothing
outside `Db.gs` addresses a cell by position.

## Identity and access

**Users** — `id, email, name, password_hash, password_salt, role_id, status,
mfa_secret, mfa_enabled, session_epoch, failed_attempts, locked_until,
institution, country, created_at, updated_at, deleted_at`

`status`: `ACTIVE | PASSWORD_RESET_REQUIRED | SUSPENDED | REVOKED`.
`session_epoch` increments to invalidate every existing session at once.

**Roles** — `id, name, description, system, ...`. `system` roles cannot be deleted.

**RolePermissions** — `role_id, permission, scope`. Scope `*` means everywhere;
otherwise a category slug or section id.

**UserGrants** — temporary delegation: `user_id, permission, scope, starts_at,
expires_at, reason, granted_by`. Expiry is evaluated on every permission check,
so a lapsed grant stops working with no cleanup job.

**Sessions** — `token_hash, user_id, epoch, created_at, expires_at, revoked_at,
ip, user_agent`. The raw token is never stored.

## Editorial

**Articles** — identity and current state: `id (MAG-YYYY-NNNNNN), slug, category,
topics, tags, level, format, status, public_version, working_version,
primary_author, co_authors, published_at, scheduled_for, sponsored`.

**Versions** — `article_id, version, payload_ref, status, created_by,
approved_by, approved_at, notes`. Body content lives in Drive
(`payload_ref`), never in a cell: sheets have a 50,000-character cell limit and
degrade badly with long text.

`status` values follow the specified workflow: `DRAFT → SUBMITTED →
EDITOR_CHECK → UNDER_REVIEW → REVISION_REQUIRED → RESUBMITTED → VERIFIED →
READY_FOR_PUBLICATION → APPROVED → SCHEDULED → PUBLISHED → ARCHIVED`, with
`REJECTED` reachable from any review state.

**Reviews** — `article_id, version, reviewer_id, decision, comments`.

**AuthorInvitations** — `token_hash, email, institution, expertise, section,
format, invited_by, expires_at, status (PENDING|ACCEPTED|EXPIRED|REVOKED)`.
Only the hash of the invitation token is stored, so a leaked sheet cannot be
used to accept an invitation.

## Configuration

**Menus, Homepage, Categories, Features, Settings, Guidelines, ArticleFormats,
FormatFields, SubmissionChecklist** — everything the spec requires to be
editable without touching code. `Content.gs` builds public JSON from these, and
`Publish.gs` commits it.

## Commerce and communication

**Advertisers, Campaigns, AdPlacements, AdCreatives, Subscribers,
EmailTemplates, EmailLogs, MagazineIssues, Backups** — created with headers in
phase 1 so later phases add behaviour, not migrations.

## AuditLogs

`ts, user_id, user_email, action, object_type, object_id, prev_version,
new_version, scope, reason, meta`. Append only. A failed audit write is logged
to Stackdriver but never blocks the action it describes.

## Public JSON contract

| File | Written from |
|---|---|
| `data/settings.json` | Settings |
| `data/menus.json` | Menus |
| `data/homepage.json` | Homepage |
| `data/categories.json` | Categories |
| `data/features.json` | Features |
| `data/index/articles.json` | Articles (published only) |
| `data/articles/<slug>.json` | Versions (public version only) |
| `data/search-index.json` | Articles (published only) |

Nothing unpublished has a file. A draft cannot leak through a guessed URL
because no URL exists.
