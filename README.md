# Van Cortlandt Park Bench Adoption

A deliberately small MVP for finding, requesting, and managing bench adoptions. A dependency-free Node server exposes a JSON API backed by SQLite, so every visitor and staff member uses the same durable source of truth.

## Run it

Requires Node 22.5+ for the built-in SQLite module (Node 24 recommended).

```bash
npm start
```

Open <http://localhost:4173>. In another terminal:

```bash
npm test
```

## What works

- Browse all 520 seeded bench records, search by bench/area, filter, and paginate.
- See whether a bench is available, adopted, or held for a pending request.
- See the public donor name, dedication, and adoption end date for adopted benches.
- Submit an adoption request with inline validation and an explicit privacy choice.
- Prevent a second request once a bench is held.
- Review, approve, or decline pending requests in the staff view.
- Persist all changes in a shared server-side SQLite database at `data/benches.db`.
- Import the park's real bench inventory from a validated CSV in Staff view.
- Treat expired adoptions as available without mutating their historical record.

## Product assumptions

The brief is intentionally open-ended, so I made these decisions explicit:

1. **A request is not an adoption.** Submitting a form immediately puts the bench in a pending/held state. Staff approval starts the adoption term.
2. **Privacy is opt-in.** Donors can choose whether their name appears publicly. Email is never shown in the public directory.
3. **One active request per bench.** This avoids conflicting promises before payment or staff review. Declining a request releases the bench.
4. **Terms are 1, 3, or 5 years.** These are placeholders for park policy, isolated in the form/domain logic so they are easy to change.
5. **No payment.** The prompt excludes payment, so approval represents the handoff to whatever offline process follows.
6. **Staff access is visible for evaluation.** A real deployment must put it behind authentication and authorization.
7. **List over map for the MVP.** A searchable list is accessible, testable, and useful even without verified coordinates. A map becomes valuable only after the park supplies accurate GIS data.

## Structure

```text
index.html          Semantic page shell and dialogs
styles.css          Responsive visual system
server.js           Static server and JSON API
src/db.js           SQLite schema, transactions, and queries
src/csv.js          Validated real-inventory import
src/data.js         Clearly labeled 520-bench evaluation seed
src/domain.js       Pure business rules and date/status logic
src/app.js          Rendering and browser interaction
test/               Domain, CSV, and database integration tests
```

The business rules are kept out of the DOM code and server writes use SQLite transactions. Competing requests cannot both reserve the same bench: each request re-checks availability inside an immediate database transaction.

## Data provenance

No official Van Cortlandt Park bench inventory was supplied with the prompt. The app therefore starts with a deterministic, visibly labeled **demo dataset** so reviewers can exercise the full workflow; it does not claim those records are real.

To load live inventory, open **Staff view → Import real bench data**, download the template, and upload a completed CSV. Importing atomically replaces the directory, clears requests tied to the previous inventory, and records the source filename and timestamp. From that point forward, the public directory, new adoption requests, and staff decisions all read and write `data/benches.db` through the API.

Required CSV columns are `bench_id`, `number`, and `area`. Optional supported columns are `feature`, `condition`, `status`, `donor_name`, `public_name`, `dedication`, `start_date`, `end_date`, and `duration_months`. Adopted rows require ISO-format start and end dates.

## Sad paths handled

- Required, invalid-email, missing-term, missing-consent, and overlong-dedication validation.
- Bench becoming unavailable before submission.
- Empty search/filter results.
- Already-pending and adopted benches cannot be requested.
- Double approval/decline protection in the domain layer.
- Anonymous public attribution.
- Expired terms becoming available.
- Invalid inventory files rejected before replacing live records.
- API/network failure messaging.
- Destructive demo reset requires confirmation.

## What I would build next

For production, the first increment would add staff authentication/authorization, an audit log, automated backups, email notifications, and deployment-managed database migrations. SQLite is appropriate for a single small deployment; a multi-instance service would use PostgreSQL with the same transactional boundary. After validating coordinates, I would add a map as an alternate—not exclusive—way to browse. I would also confirm renewal, plaque-copy moderation, accessibility, and data-retention policy with park staff before expanding the workflow.
