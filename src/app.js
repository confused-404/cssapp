import { filterBenches, formatDate, getEffectiveStatus, validateAdoption } from "./domain.js";

const PAGE_SIZE = 12;
let state = { benches: [], requests: [], meta: {} };
let filters = { search: "", area: "all", status: "all" };
let currentPage = 1;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

async function apiFetch(path, options = {}) {
  const response = await fetch(path, options);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(value.error || "The server could not complete that request.");
    error.fields = value.errors;
    throw error;
  }
  return value;
}

async function refreshState() {
  state = await apiFetch("/api/state");
  renderAll();
}

function toast(message, type = "success") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("#toast-region").append(el);
  window.setTimeout(() => el.remove(), 4500);
}

function statusLabel(bench) {
  const status = getEffectiveStatus(bench);
  return status === "pending" ? "Request pending" : status;
}

function renderStats() {
  const counts = state.benches.reduce((sum, bench) => {
    sum[getEffectiveStatus(bench)] += 1;
    return sum;
  }, { available: 0, adopted: 0, pending: 0 });
  $("#program-stats").innerHTML = `
    <div class="hero-stat"><strong>${state.benches.length}</strong><span>benches in the directory</span></div>
    <div class="hero-stat"><strong>${counts.available}</strong><span>available to adopt</span></div>`;
  $("#admin-stats").innerHTML = [
    [state.benches.length, "Total benches"], [counts.available, "Available"], [counts.adopted, "Adopted"], [counts.pending, "Pending requests"]
  ].map(([value, label]) => `<div class="admin-stat"><strong>${value}</strong><span>${label}</span></div>`).join("");
  const isDemo = state.meta.data_source !== "imported";
  $("#data-banner").hidden = !isDemo;
  $("#data-banner").textContent = "Demo dataset — import the park’s inventory from Staff view before production use.";
  $("#source-summary").textContent = `${isDemo ? "Demo data" : "Imported inventory"} · ${state.meta.source_name || "Unknown source"}`;
}

function renderAreaOptions() {
  const select = $("#area-filter");
  const areas = [...new Set(state.benches.map((bench) => bench.area))].sort((a, b) => a.localeCompare(b));
  if (filters.area !== "all" && !areas.includes(filters.area)) filters.area = "all";
  select.innerHTML = `<option value="all">All park areas</option>${areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("")}`;
  select.value = filters.area;
}

function renderBenches() {
  const matches = filterBenches(state.benches, filters);
  const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages);
  const start = (currentPage - 1) * PAGE_SIZE;
  const page = matches.slice(start, start + PAGE_SIZE);
  $("#result-count").textContent = matches.length ? `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, matches.length)} of ${matches.length}` : "0 benches";
  $("#bench-grid").innerHTML = page.map((bench) => {
    const status = getEffectiveStatus(bench);
    const note = status === "adopted" && bench.adoption
      ? `<p class="dedication">“${escapeHtml(bench.adoption.dedication || `Adopted by ${bench.adoption.publicName}`)}”</p>`
      : status === "pending" ? `<p class="dedication">An adoption request is being reviewed.</p>` : "";
    return `<article class="bench-card">
      <div class="bench-card-top"><div><p class="bench-number">#${bench.number}</p><span class="bench-id">${bench.id}</span></div><span class="status ${status}">${statusLabel(bench)}</span></div>
      <div class="bench-card-body"><h3>${escapeHtml(bench.area)}</h3><p class="bench-feature">${escapeHtml(bench.feature)}</p>${note}<button class="link-button" data-action="details" data-id="${bench.id}">View bench details</button></div>
    </article>`;
  }).join("");
  $("#bench-grid").hidden = page.length === 0;
  $("#empty-state").hidden = page.length !== 0;
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const el = $("#pagination");
  if (totalPages <= 1) { el.innerHTML = ""; return; }
  const pages = [...new Set([1, currentPage - 1, currentPage, currentPage + 1, totalPages].filter((p) => p >= 1 && p <= totalPages))].sort((a, b) => a - b);
  let previous = 0;
  el.innerHTML = pages.map((page) => {
    const gap = page - previous > 1 ? `<span aria-hidden="true">…</span>` : "";
    previous = page;
    return `${gap}<button class="page-button ${page === currentPage ? "active" : ""}" data-page="${page}" ${page === currentPage ? 'aria-current="page"' : ""} aria-label="Page ${page}">${page}</button>`;
  }).join("");
}

function openBench(benchId) {
  const bench = state.benches.find((item) => item.id === benchId);
  if (!bench) return toast("That bench could not be found.", "error");
  const status = getEffectiveStatus(bench);
  const adoption = status === "adopted" ? `<div class="dedication-block"><blockquote>“${escapeHtml(bench.adoption?.dedication || "This bench was adopted in support of the park.")}”</blockquote><cite>${escapeHtml(bench.adoption?.publicName || "Anonymous donor")} · through ${formatDate(bench.adoption?.endDate)}</cite></div>` : "";
  $("#bench-dialog-content").innerHTML = `<div class="dialog-card">
    <div class="dialog-header"><div><p class="eyebrow">Bench ${bench.id}</p><h2>Bench #${bench.number}</h2></div><button class="icon-button" data-close-dialog aria-label="Close">×</button></div>
    <span class="status ${status}">${statusLabel(bench)}</span>
    <div class="detail-grid"><div class="detail-item"><small>Park area</small><strong>${escapeHtml(bench.area)}</strong></div><div class="detail-item"><small>Nearby</small><strong>${escapeHtml(bench.feature)}</strong></div><div class="detail-item"><small>Condition</small><strong>${escapeHtml(bench.condition)}</strong></div><div class="detail-item"><small>Record ID</small><strong>${bench.id}</strong></div></div>
    ${adoption}
    ${status === "pending" ? '<p class="form-intro">A request is already under review. If it is declined, this bench will become available again.</p>' : ""}
    <div class="form-actions"><button class="button secondary" data-close-dialog>Close</button>${status === "available" ? `<button class="button" data-action="adopt" data-id="${bench.id}">Adopt this bench</button>` : ""}</div>
  </div>`;
  $("#bench-dialog").showModal();
}

function openAdoptionForm(benchId) {
  const bench = state.benches.find((item) => item.id === benchId);
  if (!bench || getEffectiveStatus(bench) !== "available") {
    $("#bench-dialog").close();
    return toast("This bench is no longer available.", "error");
  }
  $("#bench-dialog").close();
  $("#adoption-dialog-content").innerHTML = `<form id="adoption-form" class="dialog-card" novalidate>
    <div class="dialog-header"><div><p class="eyebrow">Bench ${bench.id}</p><h2>Request to adopt bench #${bench.number}</h2></div><button type="button" class="icon-button" data-close-dialog aria-label="Close">×</button></div>
    <p class="form-intro">Submitting reserves this bench while park staff review your request. No payment is collected here.</p>
    <div id="form-error" class="form-error" hidden></div>
    <div class="form-grid">
      ${field("donorName", "Your name", '<input id="donorName" name="donorName" autocomplete="name" required />')}
      ${field("email", "Email", '<input id="email" name="email" type="email" autocomplete="email" required />', "Used only to contact you about this request.")}
      ${field("durationMonths", "Adoption term", '<select id="durationMonths" name="durationMonths" required><option value="">Choose a term</option><option value="12">1 year</option><option value="36">3 years</option><option value="60">5 years</option></select>')}
      <label class="form-field full" data-field="dedication"><span>Dedication <span class="field-hint">(optional)</span></span><textarea id="dedication" name="dedication" maxlength="160" placeholder="A short message for the public bench record"></textarea><span class="field-hint"><span id="char-count">0</span>/160 characters</span><span class="field-error"></span></label>
      <label class="check-field full"><input type="checkbox" name="showName" checked /><span>Show my name publicly with the dedication. If unchecked, the directory will say “Anonymous donor.”</span></label>
      <label class="check-field full" data-field="agreed"><input type="checkbox" name="agreed" /><span>I understand this is a request, not a confirmed adoption, and park staff will contact me with next steps.</span><span class="field-error"></span></label>
    </div>
    <div class="form-actions"><button type="button" class="button secondary" data-close-dialog>Cancel</button><button class="button" type="submit">Submit request</button></div>
  </form>`;
  $("#adoption-dialog").showModal();
  $("#donorName").focus();
}

function field(name, label, control, hint = "") {
  return `<label class="form-field" data-field="${name}"><span>${label}</span>${control}${hint ? `<span class="field-hint">${hint}</span>` : ""}<span class="field-error"></span></label>`;
}

async function submitAdoption(form, benchId) {
  const formData = new FormData(form);
  const input = {
    donorName: formData.get("donorName"), email: formData.get("email"), durationMonths: Number(formData.get("durationMonths")),
    dedication: formData.get("dedication"), showName: formData.get("showName") === "on", agreed: formData.get("agreed") === "on"
  };
  const errors = validateAdoption(input);
  $$("[data-field]", form).forEach((fieldEl) => { fieldEl.classList.remove("has-error"); $(".field-error", fieldEl).textContent = ""; });
  $("#form-error").hidden = true;
  if (Object.keys(errors).length) {
    Object.entries(errors).forEach(([name, message]) => {
      const fieldEl = form.querySelector(`[data-field="${name}"]`);
      if (fieldEl) { fieldEl.classList.add("has-error"); $(".field-error", fieldEl).textContent = message; }
    });
    $("#form-error").textContent = "Please correct the highlighted fields.";
    $("#form-error").hidden = false;
    form.querySelector(".has-error input, .has-error select, .has-error textarea")?.focus();
    return;
  }
  const bench = state.benches.find((item) => item.id === benchId);
  try {
    const { request } = await apiFetch("/api/requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...input, benchId }) });
    await refreshState();
    $("#adoption-dialog-content").innerHTML = `<div class="dialog-card"><div class="success-panel"><div class="success-icon" aria-hidden="true">✓</div><h2>Request received</h2><p>Bench #${bench.number} is reserved while staff review your request. We’ll contact you at <strong>${escapeHtml(request.email)}</strong>.</p><p><small>Reference ${request.id}</small></p><button class="button" data-close-dialog>Return to benches</button></div></div>`;
  } catch (error) {
    if (error.fields) {
      Object.entries(error.fields).forEach(([name, message]) => {
        const fieldEl = form.querySelector(`[data-field="${name}"]`);
        if (fieldEl) { fieldEl.classList.add("has-error"); $(".field-error", fieldEl).textContent = message; }
      });
    }
    $("#form-error").textContent = error.message;
    $("#form-error").hidden = false;
  }
}

function renderAdmin() {
  const pending = state.requests.filter((request) => request.status === "pending").sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  $("#request-list").innerHTML = pending.length ? pending.map((request) => {
    const bench = state.benches.find((item) => item.id === request.benchId);
    return `<article class="request-card"><div><h3>${escapeHtml(request.donorName)} · Bench #${bench?.number ?? "?"}</h3><p>${escapeHtml(request.email)} · submitted ${formatDate(request.submittedAt)}</p></div><div><strong>${request.durationMonths / 12} year${request.durationMonths === 12 ? "" : "s"}</strong><p>${escapeHtml(request.dedication || "No dedication provided")}</p></div><div class="request-actions"><button class="button secondary danger" data-action="reject" data-id="${request.id}">Decline</button><button class="button" data-action="approve" data-id="${request.id}">Approve</button></div></article>`;
  }).join("") : '<div class="quiet-state"><strong>You’re all caught up.</strong><br>No adoption requests need review.</div>';
  $("#records-body").innerHTML = state.benches.slice(0, 100).map((bench) => {
    const status = getEffectiveStatus(bench);
    return `<tr><td><strong>#${bench.number}</strong><br><small>${bench.id}</small></td><td>${escapeHtml(bench.area)}</td><td><span class="status ${status}">${status}</span></td><td>${status === "adopted" ? escapeHtml(bench.adoption?.publicName || "Anonymous donor") : "—"}</td><td>${status === "adopted" ? `${formatDate(bench.adoption?.startDate)} – ${formatDate(bench.adoption?.endDate)}` : "—"}</td></tr>`;
  }).join("");
}

async function reviewRequest(requestId, decision) {
  try {
    await apiFetch(`/api/requests/${encodeURIComponent(requestId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    await refreshState();
    toast(`Request ${decision === "approve" ? "approved" : "declined"}.`);
  } catch (error) { toast(error.message, "error"); }
}

function switchRoute(route) {
  $("#browse-view").hidden = route !== "browse";
  $("#admin-view").hidden = route !== "admin";
  $$("[data-route]").forEach((item) => item.classList.toggle("active", item.dataset.route === route));
  if (route === "admin") renderAdmin();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function clearFilters() {
  filters = { search: "", area: "all", status: "all" };
  currentPage = 1;
  $("#filters").reset();
  renderBenches();
}

function renderAll() { renderAreaOptions(); renderStats(); renderBenches(); renderAdmin(); }

async function importInventory(event) {
  event.preventDefault();
  const file = $("#inventory-file").files[0];
  if (!file) return toast("Choose a CSV file to import.", "error");
  if (!window.confirm(`Replace the current directory with ${file.name}? Existing adoption requests will be cleared.`)) return;
  try {
    const result = await apiFetch("/api/admin/import", { method: "POST", headers: { "content-type": "text/csv", "x-source-name": file.name }, body: await file.text() });
    await refreshState();
    event.target.reset();
    toast(`Imported ${result.count} bench records.`);
  } catch (error) { toast(`Import failed: ${error.message}`, "error"); }
}

function downloadTemplate() {
  const template = "bench_id,number,area,feature,condition,status,donor_name,public_name,dedication,start_date,end_date,duration_months\nL-001,1,Van Cortlandt Lake,Lake views,Good,available,,,,,,\n";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([template], { type: "text/csv" }));
  link.download = "bench-inventory-template.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function initialize() {
  $("#filters").addEventListener("input", (event) => {
    if (event.target.id === "search") filters.search = event.target.value;
    if (event.target.id === "area-filter") filters.area = event.target.value;
    if (event.target.id === "status-filter") filters.status = event.target.value;
    currentPage = 1; renderBenches();
  });
  $("#filters").addEventListener("reset", () => window.setTimeout(clearFilters));
  document.addEventListener("click", (event) => {
    const route = event.target.closest("[data-route]");
    const action = event.target.closest("[data-action]");
    const page = event.target.closest("[data-page]");
    const close = event.target.closest("[data-close-dialog]");
    if (route) { event.preventDefault(); switchRoute(route.dataset.route); }
    if (page) { currentPage = Number(page.dataset.page); renderBenches(); $("#browse-heading").scrollIntoView(); }
    if (close) close.closest("dialog")?.close();
    if (!action) return;
    if (action.dataset.action === "details") openBench(action.dataset.id);
    if (action.dataset.action === "adopt") openAdoptionForm(action.dataset.id);
    if (action.dataset.action === "clear-filters") clearFilters();
    if (action.dataset.action === "approve" || action.dataset.action === "reject") reviewRequest(action.dataset.id, action.dataset.action);
  });
  $("#adoption-dialog").addEventListener("input", (event) => {
    if (event.target.id === "dedication") $("#char-count").textContent = event.target.value.length;
  });
  $("#adoption-dialog").addEventListener("submit", (event) => {
    event.preventDefault();
    const benchId = $(".eyebrow", event.target)?.textContent.replace("Bench ", "");
    submitAdoption(event.target, benchId);
  });
  $("#reset-demo").addEventListener("click", () => $("#confirm-dialog").showModal());
  $("#confirm-reset").addEventListener("click", async () => { try { await apiFetch("/api/admin/reset-demo", { method: "POST" }); await refreshState(); toast("Demo data was reset."); } catch (error) { toast(error.message, "error"); } });
  $("#import-form").addEventListener("submit", importInventory);
  $("#download-template").addEventListener("click", downloadTemplate);
  [$("#bench-dialog"), $("#adoption-dialog"), $("#confirm-dialog")].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  try { await refreshState(); }
  catch (error) {
    $("#bench-grid").innerHTML = `<div class="quiet-state"><strong>We couldn’t load the bench directory.</strong><br>${escapeHtml(error.message)} Refresh the page to try again.</div>`;
    $("#result-count").textContent = "Unavailable";
    toast("Could not connect to the bench data service.", "error");
  }
}

initialize();
