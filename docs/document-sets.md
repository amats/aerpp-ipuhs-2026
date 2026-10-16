# Research document sets

A document set binds the study's displayed text and downloadable originals to
each accepted consent or withdrawal. Firestore stores the reference on the
participation record; there is no document-set registry or mutable cloud
`latest` pointer. [Questionnaire definitions](examples.md#questionnaire-definitions)
have a separate identity and lifecycle.

## Identity and current version

The eight members are `welcome.mdx`, `explanation.mdx`, `consent.mdx`,
`withdrawal.mdx`, `explanation.pdf`, `consent.pdf`, `withdrawal.pdf` and `plan.pdf`.
The MDX originals cover the study text and consent checks, rather than a copy of
the entire application. Preserve supplied text and PDF bodies.

`config/common/documents/version.json` owns the human version, initially `1.0`.
The shared `@aerpp/config/document-set` helper constructs a canonical manifest:
`{ schemaVersion: 1, version, files: [{ name, size, sha256 }] }`. Members are sorted
by filename; object keys use JCS order. File size and SHA-256 describe exact
original bytes, without PDF or MDX normalization. The full canonical manifest's
SHA-256 and version form `documentSet: { version, sha256 }`. Timestamps,
environment settings, completed PDFs and generated footers are not inputs.
Changing a version or any original changes the reference. Human versions alone
are not unique keys; operators should increment the version for a new release.

The selected set is computed and fixed into the Web build, including its browser
bundle. Standalone outputs retain those exact originals and version input. The
deployed image, rather than later source edits or a cloud pointer, determines the
current set. Public browser tests use the complete public set; distribution
images use the complete private set without mixing sources.

## Archive and delivery

The selected project's private `${projectId}-documents` bucket retains originals
at `document-sets/jcs-v1/sha256/<set digest>/<filename>` and `manifest.json`.
It has versioning, public access prevention and no deletion lifecycle. The
operator has create/view permission; Support and both Admin runtimes have view
permission only. Filled PDFs, emails and participant data never enter the bucket.
Preserve referenced sets independently of image cleanup and participant withdrawal.

After building and checking Web, run `pnpm run web:prepare-documents <environment>`
to inspect its immutable image, then add `--apply` only for an authorized cloud
registration. The command extracts actual image originals, uploads create-only,
verifies stored bytes and registers the manifest last. A conflicting existing
object fails verification. A private registration receipt binds the selected
project, image ID and document reference. Bundle export requires that receipt,
as well as the separate questionnaire registration. Apply the reviewed bucket
and IAM infrastructure before registration; local inspection does not prove cloud
access or successful registration.

## Consent, withdrawal and retries

Preparing or sending mail does not establish consent. Successful server-side
email confirmation records `consentConfirmedAt` and the originally prepared
document reference together. Before first dispatch, Web rejects a stale displayed
set and asks for reload. A dispatched request, including an uncertain response,
retains its original request ID and set across deployments and exact retries.
Support rejects attempts to relabel the same consent request. A new browser
continues to use consent followed by email confirmation; no download-only
authentication route is added. Client ID retains its existing browser-use role.

Before preparing the first withdrawal request, Web checks the displayed set
before acquiring withdrawal priority or cancelling ordinary operations. An
outdated or missing reference leaves the session usable and requires reload.
An already saved request retains its original set and withdrawal fence across
deployments and retries.

The first accepted withdrawal records its own document reference,
`withdrawalAcceptedAt` and linked `consentId`. Retries preserve that receipt,
including its original date and set, while continuing pending deletion. No
Cloud Storage read or PDF generation occurs in the acceptance/deletion
transaction. PDF failure cannot undo withdrawal or block research cleanup.
Participation references and audit records survive research deletion.

## Copies, verification and reissue

Consent and withdrawal copies use the selected record's own date, encrypted
contact and original set. The last-page footer contains a small version label,
the [v2 DID](identifiers.md#reproducible-pid-and-did) and full set SHA-256.
Explanation and plan PDFs contain only the version footer. Email/date fields are
filled and flattened; the DID is drawn directly in the footer. Hashes refer to the set
manifest and original files, never the generated participant copy. Downloads are
generated in RAM by the shared [PDF renderer](../packages/documents/README.md)
without a server-side filled-PDF archive. Web/Admin retain record selection,
authorization and original verification at their application boundaries.

An existing valid authenticated, follow-up or withdrawn session can retrieve its
owner's consent/withdrawal history across browsers and participation periods.
The default consent download uses that session's own confirmation; history
downloads select an exact record. Current-set originals are verified locally;
older originals are fetched through Support using the owned record reference.
Every manifest and requested original is verified. Missing, corrupt or unknown
references fail without substituting a current template. Session loss requires
researcher reissue, rather than fresh authentication solely for downloads.

Admin verification accepts the printed email, Japan date, purpose, DID, version
and set SHA-256. It reports three separate facts: mathematical DID match, archive
integrity and matching accepted participation history. A DID match alone proves
neither acceptance nor delivery. Admin can reissue an exact selected record within
its configured server scope. Durable `accessEvents` record the hashed operator,
record ID, set, purpose, request time and outcome before returning the PDF.
`generated` means prepared by the server, not delivered to a participant.
Reissue neither restores deleted research data nor changes participation rights.
Failures retain diagnostics without contact, ciphertext or PDF content.
