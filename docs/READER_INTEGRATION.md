# Reader integration contract

## What is implemented

The app provisions per-reader HMAC credentials, encrypts them at rest with AES-256-GCM, maps RFID/QR tags to trolleys and stores immutable observations. Each reader has a fixed configured location. Keys are shown once on creation/rotation; administrators can revoke readers. A QR label's value is the exact trolley ID.

This is a tested HTTP adapter contract, not a driver for an unspecified RFID reader. Confirm the reader's serial/TCP/HTTP protocol, antenna arrangement, gate direction and tag format before building the physical bridge. Observations do not depart trolleys or confirm arrivals automatically. Unknown tags are retained for investigation and are not assigned by guesswork.

## Setup

1. Generate a wrapping key on the server: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
2. Set DEVICE_ENCRYPTION_KEY in the server's .env to those 64 hex characters and restart. Back up the key separately; losing it prevents verification of existing reader credentials.
3. Sign in as an administrator. In Readers & tags, create a reader and select its installed location. Save the returned secret into the reader bridge's protected configuration.
4. Assign each RFID tag to its trolley. A tag already mapped to another trolley cannot be reassigned silently.
5. Configure the bridge's TROLLEY_SERVER, READER_ID and READER_SECRET. Run `node scripts/send-reader-event.mjs RFID-001` to test ingestion. These credentials belong to that reader and do not grant UI access or mutation rights for trolley movements.
6. Verify the observation in Readers & tags, compare the physical gate/location, and record operational receipt separately.

## Wire format

POST /api/reader-events with Content-Type: application/json.

Headers:

- X-Device-Id: the provisioned reader ID.
- X-Device-Timestamp: current Unix epoch milliseconds, within five minutes of server time.
- X-Device-Signature: hex HMAC-SHA256 using the issued secret string over `timestamp + '.' + exactRawJsonBody`.

Body example:

    {"eventId":"reader-1-unique-event-123","tag":"RFID-001","observedAt":1791907200000}

Use a stable eventId for an observation, including retries. Send newly timestamped signatures on retries without changing the body or eventId. Matching duplicate observations return the original record with duplicate=true; different observations reusing an eventId return 409. A reader's location is taken from server configuration, not from the request body.

For offline buffering, the bridge must persist the event before transmitting and retain it until acknowledgment. It can sign buffered observations at transmission time; observedAt may be up to seven days old, with five minutes of future clock tolerance. This release includes the sender/test adapter, not a durable automatic offline queue. Events older than seven days require a separately designed reconciliation process. A replay must never become an operational trolley movement.

## Transport and key lifecycle

Use HTTPS outside localhost. Rotating a reader secret invalidates its previous secret immediately. Deactivating it denies further ingestion while preserving events. Back up encrypted reader records and the deployment wrapping key independently. To change the wrapping key, re-encryption/provisioning must be planned; changing the environment value alone does not rotate existing encrypted secrets.

## Camera QR scanning

The scanner asks for the rear camera, tries the native QR detector, and falls back to self-hosted jsQR. Frames stay in the browser. It stops after a registered trolley is detected, when stopped manually, on navigation, on page hiding and on sign-out. A decoded ID fills the form for review; it does not submit a movement. USB keyboard scanners and typed IDs remain available when camera permissions or secure transport are missing. Print/open labels from the Trolley fleet page.
