# Identifier contracts

Identifiers have different jobs: reproducible participant/document linkage,
independent operation identity, and authentication secrets. An identifier alone
never grants permission. Support checks the full owner and consent boundary;
retained analysis IDs remain reserved after research deletion.

## Selected representations

| Identifier | Representation | Reason |
| --- | --- | --- |
| PID | `aerpp:pid-` + 32 lowercase hexadecimal characters | Reproducible email linkage; domain-separated HMAC-SHA-256 truncated to 128 bits |
| PDF DID | `aerpp:did-` + 32 lowercase hexadecimal characters | Reproducible email/Japan-date/document-purpose/document-set binding, 42 characters including prefix |
| Client and analysis IDs | `aerpp:cid-` / `aerpp:aid-` + 32 random alphanumeric characters | Independent identity, approximately 190 bits of random space; rejection sampling guarantees exact length without alphabet bias |
| Consent ID | 20 random alphanumeric characters | Approximately 119 bits; generated with cryptographic `randomInt`, reused only for the same authentication request |
| Session, tab, recovery, export and reset IDs | UUIDv4, 36 characters | Standard independent operation identity; tab generation sets the RFC version and variant bits |
| Bearer/session credentials and mail nonces | 32 random bytes, Base64url where encoded | Authentication material has a separate 256-bit contract; never shorten it to an ID or log it |
| Typed audit/document keys | SHA-256 of canonical operation/owner inputs | Deterministic retry addressing; authorization and immutable-receipt checks remain necessary |

Random IDs are not client claims of ownership. Browsers submit documents to the
Web start action; Web generates the analysis ID. Authenticated Support callers
must still obey owner, consent and retained-ID constraints. Hashing an owner into
an analysis ID would neither prevent replay nor replace those checks.

## Reproducible PID and DID

The Node-only `@aerpp/participant-api-contracts/identifiers` export is the common
implementation for Web and Admin. The browser-safe participant API export does
not import it. Normalize email in this exact order: trim, lowercase, NFKC.
Use the literal UTF-8 bytes of the configured identifier secret, without trimming.

HMAC input is UTF-8 `JSON.stringify` of one of these arrays:

- PID: `["aerpp:pid:v1", normalizedEmail]`
- DID: `["aerpp:did:v2", normalizedEmail, purpose, japanDate, documentSetSha256]`

`purpose` is exactly `consent` or `withdrawal`. `japanDate` is `YYYY年M月D日`,
without zero padding, using the Gregorian Japan calendar date (UTC +09:00).
The shared formatter constructs this string without locale-dependent formatting.
Take the first 32 lowercase hexadecimal characters of the HMAC-SHA-256 output,
then add the corresponding prefix. Purpose/domain separation avoids treating a
participant identifier as document evidence.

DID binds email, Japan date, purpose and the full document-set manifest SHA-256.
The same combination produces the same DID, including multiple confirmations on
the same day. The manifest binds its human version and exact original bytes;
see [document sets](document-sets.md). DID is not an event ID, a download receipt,
or a signature over the generated participant PDF. Possession of a valid DID
establishes neither current participation nor authorization.

Freeze the version/domain strings, normalization order, serialization, encoding,
length, date construction and identifier key before study commencement. Preserve
that key for historical reproduction. Reproducing or verifying a PID/DID requires
the same key and derivation contract used to create it. Do not replace a key or algorithm
during the study. Secret holders can create DIDs, so verification assumes trusted
Web/Admin operators and protected server keys.

Admin's authenticated **PDFのDID照合** accepts the printed email, date, purpose,
DID, document version and full set SHA-256. It reports mathematical agreement,
verified archived originals and matching consent/withdrawal receipt separately.
Unavailable storage/history is not a confirmed receipt. Input edits remove the
previous result. It neither stores/logs the entered email nor returns a newly
generated DID. No PDF upload or body extraction is needed.

## Alternatives considered

| Option | Strength / length | Assessment |
| --- | --- | --- |
| UUIDv4 for every ID | 122 random bits; 36 characters before application prefix | Good for independent events, but cannot reproduce an email mapping; longer than the selected PDF suffix |
| UUIDv7 | Time-ordered UUID with timestamp and random fields | Useful for ordered storage; unnecessary here because receipt times are explicit and Firestore document IDs need no time ordering |
| Random 16-byte hexadecimal ID | 128 random bits; 32 characters | Good independent identity; cannot reproduce PID/DID |
| Random 32-character alphanumeric ID | About 190 random bits; 32 characters | Retained for independent client/analysis identity, with fixed-length unbiased generation |
| Full HMAC-SHA-256 | 64 hexadecimal or 43 unpadded Base64url characters | Strong reproducible binding, but adds PDF/manual-comparison length without a present need |
| Selected truncated HMAC | 128-bit output; 32 hexadecimal characters | Sufficient space for this study and practical manual copying; not an authentication token |
| Plain hash of email/date, or owner-based ID hash | Deterministic; depends on input secrecy/entropy | Publicly enumerable without a secret and does not prevent ID replay; use keyed derivation and server reservations |

UUID version/variant and generation rules are specified in
[RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html); Node's cryptographic
[UUID/random primitives](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions)
provide the server implementations. Random collision risk remains nonzero for
all finite representations; immutable owner checks and ID reservations are the
correct response to any collision.
