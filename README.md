# Van Cortlandt Park Bench Adoption

A deliberately small MVP for finding, requesting, and managing bench adoptions. A dependency-free Node server exposes a JSON API backed by SQLite, with the business rules kept separate from the browser UI.

## Run it

Requires Node 22.5+ for the built-in SQLite module (Node 24 recommended).

```bash
npm install
npm start
```

Open <http://localhost:4173>. In another terminal:

```bash
npm test
```

## Reviewer tour

1. Open the public directory and search, filter, switch views, and open a bench detail dialog.
2. Choose an available bench, submit a request, and confirm that it becomes pending.
3. Open **Staff view** and log in with the demo account below.
4. Approve or decline the request, then return to the public directory to see the updated status.
5. Try the CSV template and photo manager from the staff workspace. **Reset demo data** restores the seeded dataset while demo data is active.

The generated dataset is intentionally fictional and safe to reset. It is there so the complete workflow can be evaluated without an external inventory.

## What works

- Browse all 520 seeded bench records, search by bench/area, filter, and paginate.
- Switch between photo-forward cards and a compact scanning list; the first gallery photo becomes the card cover, and the preference is remembered per browser.
- Filter the directory to benches with photos or without photos.
- See whether a bench is available, adopted, or held for a pending request.
- See the public donor name, dedication, and adoption end date for adopted benches.
- View an optional photo gallery for the bench and surrounding area.
- Submit an adoption request with inline validation and an explicit privacy choice.
- Prevent a second request once a bench is held.
- Review, approve, or decline pending requests in the staff view.
- Print a clearly labeled mock email notification to the server console when staff approve or decline a request; no email provider is connected.
- Store the current directory and adoption records in server-side SQLite at `data/benches.db`; completed adoptions are also retained in a private history table.
- Import the park's real bench inventory from a validated CSV in Staff view.
- Upload, caption, and remove up to six public photos per bench from Staff view.
- Search and combine area, lifecycle status, condition, and photo filters across the complete staff directory; sort every operational column and paginate at 25, 50, or 100 rows.
- Log in with a salted password hash and retain access through a revocable HTTP-only server session. Open signup is disabled by default.
- Treat expired adoptions as available without mutating their historical record.

## Product assumptions

The brief is intentionally open-ended, so I made these decisions explicit:

1. **A request is not an adoption.** Submitting a form immediately puts the bench in a pending/held state. Staff approval starts the adoption term.
2. **Privacy is opt-in.** Donors can choose whether their name appears publicly. Email is never shown in the public directory.
3. **One active request per bench.** This avoids conflicting promises before payment or staff review. Declining a request releases the bench.
4. **Terms are 1, 3, or 5 years.** These are placeholders for park policy, isolated in the form/domain logic so they are easy to change.
5. **No payment.** The prompt excludes payment, so approval represents the handoff to whatever offline process follows.
6. **Staff access is visible for evaluation.** Staff mutations require authentication. Open signup is disabled by default; enable `ALLOW_OPEN_SIGNUP=true` only for a controlled demo.
7. **List over map for the MVP.** A searchable list is accessible, testable, and useful even without verified coordinates. A map becomes valuable only after the park supplies accurate GIS data.

## Structure

```text
index.html          Semantic page shell and dialogs
styles.css          Responsive visual system
server.js           Static server and JSON API
src/db.js           SQLite schema, transactions, queries, and history
src/csv.js          Validated real-inventory import
src/data.js         Server-only first-run seed inserted into SQLite
src/images.js       Image limits and content-signature validation
src/domain.js       Pure business rules and date/status logic
src/app.js          Rendering and browser interaction
test/               Domain, CSV, and database integration tests
```

The business rules are kept out of the DOM code and server writes use SQLite transactions. Competing requests cannot both reserve the same bench: each request re-checks availability inside an immediate database transaction.

## Data provenance

No official Van Cortlandt Park bench inventory was supplied with the prompt. When the database has no bench rows, the server automatically inserts a deterministic, visibly labeled **demo dataset** into SQLite so reviewers can exercise the full workflow; it does not claim those records are real. Every demo bench marked pending has a matching staff request, including a reconciliation step for databases created by older versions. Three demo benches also receive public-domain sample gallery photos, clearly captioned as samples. All public and staff views read the database through the API.

Stock-photo provenance and licenses are recorded in [`assets/stock/README.md`](assets/stock/README.md). Imported real inventories never receive these sample photos.

## Demo staff account

The generated demo database includes:

```text
Email: test@gmail.com
Password: test
```

Staff requests and mutation endpoints require an authenticated session. Passwords are salted and hashed with Node's `scrypt`; the browser receives only an HTTP-only, same-site session cookie. Open signup is disabled by default; a controlled demo can set `ALLOW_OPEN_SIGNUP=true`. A production deployment should replace it with invitation-only account creation or an organization identity provider.

To load live inventory, open **Staff view → Import real bench data**, download the template, and upload a completed CSV. Importing atomically replaces the directory, clears requests tied to the previous inventory, and records the source filename and timestamp. From that point forward, the public directory, new adoption requests, and staff decisions all read and write `data/benches.db` through the API.

Required CSV columns are `bench_id`, `number`, and `area`. Optional supported columns are `feature`, `condition`, `status`, `donor_name`, `public_name`, `dedication`, `start_date`, `end_date`, and `duration_months`. Adopted rows require ISO-format start and end dates.

## Demo hosting note

The app works on a single Render Web Service without a persistent disk for a disposable presentation. Set the service to run `npm start`, use Node 24, and keep `ALLOW_OPEN_SIGNUP` unset or `false`. The service binds to Render's `PORT` and uses an ephemeral SQLite file, so requests, photos, and imported data can reset after a sleep, restart, or redeploy. That is expected for this demo; use persistent storage and backups before treating the data as real.

## Sad paths handled

- Required, invalid-email, missing-term, missing-consent, and overlong-dedication validation.
- Bench becoming unavailable before submission.
- Empty search/filter results.
- Already-pending and adopted benches cannot be requested.
- Double approval/decline protection in the domain layer.
- Anonymous public attribution.
- Expired terms becoming available.
- Invalid inventory files rejected before replacing live records.
- Non-image uploads, files over 5 MB, captions over 160 characters, and a seventh photo rejected server-side.
- API/network failure messaging.
- Destructive demo reset requires confirmation and is unavailable once imported inventory is active.

## What I would build next

For production, the first increment would add role-based authorization, invitation-only account creation, password resets, login throttling, CSRF protection, an audit log, automated backups, email notifications, and deployment-managed database migrations. SQLite is appropriate for a single small deployment; a multi-instance service would use PostgreSQL with the same transactional boundary. After validating coordinates, I would add a map as an alternate—not exclusive—way to browse. I would also confirm renewal, plaque-copy moderation, accessibility, and data-retention policy with park staff before expanding the workflow.
