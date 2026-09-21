import { filterAdminBenches, filterBenches, formatDate, getAdminStatus, getEffectiveStatus, sortAdminBenches, validateAdoption } from "./domain.js";

const PAGE_SIZE = 12;
let state = { benches: [], requests: [], meta: {} };
let filters = { search: "", area: "all", status: "all", photos: "all" };
let currentPage = 1;
let viewMode = "card";
let selectedPhotoBenchId = null;
let adminFilters = { search: "", area: "all", status: "all", photos: "all", condition: "all" };
let adminSort = { key: "number", direction: "asc" };
let adminPage = 1;
let adminPageSize = 25;
let currentAdmin = null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);

async function apiFetch(path, options = {}) {
  const response = await fetch(path, options);
  const value = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(value.error || "The server could not complete that request.");
    error.fields = value.errors;
    error.status = response.status;
    throw error;
  }
  return value;
}

async function refreshState() {
  state = await apiFetch(currentAdmin ? "/api/admin/state" : "/api/state");
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
  if (status === "available") return "Available now";
  if (status === "adopted") return "Currently adopted";
  return "Request pending";
}

function adminStatusLabel(status) {
  return { available: "Available", adopted: "Currently adopted", pending: "Request pending", expired: "Expired adoption" }[status] || status;
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
  $("#demo-credentials").hidden = !isDemo;
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
  $("#bench-grid").classList.toggle("list-view", viewMode === "list");
  $$('[data-view]').forEach((button) => {
    const active = button.dataset.view === viewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("#bench-grid").innerHTML = page.map((bench) => {
    const status = getEffectiveStatus(bench);
    const note = status === "adopted" && bench.adoption
      ? `<p class="dedication">“${escapeHtml(bench.adoption.dedication || `Adopted by ${bench.adoption.publicName}`)}”</p>`
      : status === "pending" ? `<p class="dedication">An adoption request is being reviewed.</p>` : "";
    const cover = bench.images[0]?.url;
    return `<article class="bench-card" data-status="${status}">
      <div class="bench-card-top ${cover ? "has-cover" : ""}" ${cover ? `style="background-image:url('${escapeHtml(cover)}')"` : ""}><div><p class="bench-number">#${bench.number}</p><span class="bench-id">${bench.id}</span></div><span class="status ${status}">${statusLabel(bench)}</span></div>
      <div class="bench-card-body"><div class="bench-summary"><h3>${escapeHtml(bench.area)}</h3><p class="bench-feature">${escapeHtml(bench.feature)}</p>${bench.images.length ? `<span class="photo-count" aria-label="${bench.images.length} photos">▧ ${bench.images.length} photo${bench.images.length === 1 ? "" : "s"}</span>` : ""}</div><div class="list-note">${note}</div><button class="link-button" data-action="details" data-id="${bench.id}">View bench details</button></div>
    </article>`;
  }).join("");
  $("#bench-grid").hidden = page.length === 0;
  $("#empty-state").hidden = page.length !== 0;
  renderPagination(totalPages);
}

function galleryMarkup(bench) {
  if (!bench.images.length) return "";
  const first = bench.images[0];
  const alt = first.caption || `Bench #${bench.number} and the surrounding ${bench.area} area`;
  return `<figure class="bench-gallery">
    <div class="gallery-main"><img id="gallery-main-image" src="${first.url}" alt="${escapeHtml(alt)}" /><figcaption id="gallery-caption" ${first.caption ? "" : "hidden"}>${escapeHtml(first.caption)}</figcaption></div>
    ${bench.images.length > 1 ? `<div class="gallery-thumbs" aria-label="Bench photo gallery">${bench.images.map((image, index) => `<button class="gallery-thumb ${index === 0 ? "active" : ""}" data-action="gallery-photo" data-bench-id="${bench.id}" data-image-id="${image.id}" aria-label="View photo ${index + 1}" aria-pressed="${index === 0}"><img src="${image.url}" alt="" /></button>`).join("")}</div>` : ""}
  </figure>`;
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
    ${galleryMarkup(bench)}
    <span class="status ${status}">${statusLabel(bench)}</span>
    <div class="detail-grid"><div class="detail-item"><small>Park area</small><strong>${escapeHtml(bench.area)}</strong></div><div class="detail-item"><small>Nearby</small><strong>${escapeHtml(bench.feature)}</strong></div><div class="detail-item"><small>Condition</small><strong>${escapeHtml(bench.condition)}</strong></div><div class="detail-item"><small>Record ID</small><strong>${bench.id}</strong></div></div>
    ${adoption}
    ${status === "pending" ? '<p class="form-intro">A request is already under review. If it is declined, this bench will become available again.</p>' : ""}
    <div class="form-actions"><button class="button secondary" data-close-dialog>Close</button>${status === "available" ? `<button class="button" data-action="adopt" data-id="${bench.id}">Adopt this bench</button>` : ""}</div>
  </div>`;
  $("#bench-dialog").showModal();
}

function showGalleryImage(benchId, imageId, button) {
  const bench = state.benches.find((item) => item.id === benchId);
  const image = bench?.images.find((item) => item.id === imageId);
  if (!image) return;
  const main = $("#gallery-main-image");
  const caption = $("#gallery-caption");
  main.src = image.url;
  main.alt = image.caption || `Bench #${bench.number} and the surrounding ${bench.area} area`;
  caption.textContent = image.caption;
  caption.hidden = !image.caption;
  $$(".gallery-thumb").forEach((thumb) => { thumb.classList.toggle("active", thumb === button); thumb.setAttribute("aria-pressed", String(thumb === button)); });
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
  $("#admin-email").textContent = currentAdmin?.email || "";
  const pending = state.requests.filter((request) => request.status === "pending").sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  $("#request-list").innerHTML = pending.length ? pending.map((request) => {
    const bench = state.benches.find((item) => item.id === request.benchId);
    return `<article class="request-card"><div><h3>${escapeHtml(request.donorName)} · Bench #${bench?.number ?? "?"}</h3><p>${escapeHtml(request.email)} · submitted ${formatDate(request.submittedAt)}</p></div><div><strong>${request.durationMonths / 12} year${request.durationMonths === 12 ? "" : "s"}</strong><p>${escapeHtml(request.dedication || "No dedication provided")}</p></div><div class="request-actions"><button class="button secondary danger" data-action="reject" data-id="${request.id}">Decline</button><button class="button" data-action="approve" data-id="${request.id}">Approve</button></div></article>`;
  }).join("") : '<div class="quiet-state"><strong>You’re all caught up.</strong><br>No adoption requests need review.</div>';
  renderAdminFilterOptions();
  renderAdminRecords();
  renderPhotoManager();
}

function renderAdminFilterOptions() {
  const areaSelect = $("#admin-area-filter");
  const conditionSelect = $("#admin-condition-filter");
  const areas = [...new Set(state.benches.map((bench) => bench.area))].sort((a, b) => a.localeCompare(b));
  const conditions = [...new Set(state.benches.map((bench) => bench.condition))].sort((a, b) => a.localeCompare(b));
  if (adminFilters.area !== "all" && !areas.includes(adminFilters.area)) adminFilters.area = "all";
  if (adminFilters.condition !== "all" && !conditions.includes(adminFilters.condition)) adminFilters.condition = "all";
  areaSelect.innerHTML = `<option value="all">All areas</option>${areas.map((area) => `<option value="${escapeHtml(area)}">${escapeHtml(area)}</option>`).join("")}`;
  conditionSelect.innerHTML = `<option value="all">All conditions</option>${conditions.map((condition) => `<option value="${escapeHtml(condition)}">${escapeHtml(condition)}</option>`).join("")}`;
  areaSelect.value = adminFilters.area;
  conditionSelect.value = adminFilters.condition;
}

function renderAdminRecords() {
  const filtered = filterAdminBenches(state.benches, adminFilters);
  const sorted = sortAdminBenches(filtered, adminSort);
  const totalPages = Math.max(1, Math.ceil(sorted.length / adminPageSize));
  adminPage = Math.min(adminPage, totalPages);
  const start = (adminPage - 1) * adminPageSize;
  const page = sorted.slice(start, start + adminPageSize);
  $("#records-count").textContent = sorted.length ? `Showing ${start + 1}–${Math.min(start + adminPageSize, sorted.length)} of ${sorted.length}` : "0 records";
  $("#records-body").innerHTML = page.length ? page.map((bench) => {
    const status = getAdminStatus(bench);
    const hasAdoption = status === "adopted" || status === "expired";
    return `<tr><td><strong>#${bench.number}</strong><br><small>${bench.id}</small></td><td>${escapeHtml(bench.area)}<br><small>${escapeHtml(bench.condition)}</small></td><td><span class="status ${status}">${adminStatusLabel(status)}</span></td><td>${bench.images.length}</td><td>${hasAdoption ? escapeHtml(bench.adoption?.publicName || "Anonymous donor") : "—"}</td><td>${hasAdoption ? formatDate(bench.adoption?.endDate) : "—"}</td></tr>`;
  }).join("") : '<tr><td class="table-empty" colspan="6"><strong>No bench records match these filters.</strong><br>Clear one or more filters to broaden the results.</td></tr>';
  $$('[data-sort-header]').forEach((header) => {
    const active = header.dataset.sortHeader === adminSort.key;
    header.setAttribute("aria-sort", active ? (adminSort.direction === "asc" ? "ascending" : "descending") : "none");
    $(".sort-button span", header).textContent = active ? (adminSort.direction === "asc" ? "↑" : "↓") : "";
  });
  renderAdminPagination(totalPages);
}

function renderAdminPagination(totalPages) {
  const pagination = $("#admin-pagination");
  if (totalPages <= 1) { pagination.innerHTML = ""; return; }
  const pages = [...new Set([1, adminPage - 1, adminPage, adminPage + 1, totalPages].filter((page) => page >= 1 && page <= totalPages))].sort((a, b) => a - b);
  let previous = 0;
  pagination.innerHTML = pages.map((page) => {
    const gap = page - previous > 1 ? '<span aria-hidden="true">…</span>' : "";
    previous = page;
    return `${gap}<button class="page-button ${page === adminPage ? "active" : ""}" data-admin-page="${page}" ${page === adminPage ? 'aria-current="page"' : ""} aria-label="Bench records page ${page}">${page}</button>`;
  }).join("");
}

function clearAdminFilters() {
  adminFilters = { search: "", area: "all", status: "all", photos: "all", condition: "all" };
  adminPage = 1;
  $("#admin-search").value = "";
  $("#admin-area-filter").value = "all";
  $("#admin-status-filter").value = "all";
  $("#admin-photo-filter").value = "all";
  $("#admin-condition-filter").value = "all";
  renderAdminRecords();
}

function renderPhotoManager() {
  if (!state.benches.length) {
    $("#photo-bench-select").innerHTML = "";
    $("#staff-photo-list").innerHTML = '<div class="quiet-state">Import a bench inventory before adding photos.</div>';
    return;
  }
  if (!selectedPhotoBenchId || !state.benches.some((bench) => bench.id === selectedPhotoBenchId)) selectedPhotoBenchId = state.benches[0].id;
  const select = $("#photo-bench-select");
  select.innerHTML = state.benches.map((bench) => `<option value="${bench.id}">#${bench.number} · ${escapeHtml(bench.area)} (${bench.id})</option>`).join("");
  select.value = selectedPhotoBenchId;
  const bench = state.benches.find((item) => item.id === selectedPhotoBenchId);
  $("#staff-photo-list").innerHTML = bench.images.length ? bench.images.map((image) => `<article class="staff-photo"><img src="${image.url}" alt="${escapeHtml(image.caption || `Bench #${bench.number} photo`)}" /><div class="staff-photo-info"><p title="${escapeHtml(image.caption || image.filename)}">${escapeHtml(image.caption || image.filename)}</p><button class="link-button" data-action="delete-photo" data-bench-id="${bench.id}" data-image-id="${image.id}">Remove</button></div></article>`).join("") : '<div class="quiet-state"><strong>No photos yet.</strong><br>Add a photo to help people understand this location.</div>';
  const submit = $("#photo-upload-form button[type='submit']");
  submit.disabled = bench.images.length >= 6;
  submit.textContent = bench.images.length >= 6 ? "Six-photo limit reached" : "Add photo";
}

async function uploadPhoto(event) {
  event.preventDefault();
  const file = $("#photo-file").files[0];
  const caption = $("#photo-caption").value.trim();
  if (!file) return toast("Choose a photo to upload.", "error");
  if (file.size > 5_000_000) return toast("That photo is larger than 5 MB.", "error");
  try {
    const query = new URLSearchParams({ filename: file.name, caption });
    await apiFetch(`/api/admin/benches/${encodeURIComponent(selectedPhotoBenchId)}/images?${query}`, { method: "POST", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
    await refreshState();
    event.target.reset();
    toast("Photo added to the public gallery.");
  } catch (error) { toast(error.message, "error"); }
}

async function deletePhoto(benchId, imageId) {
  if (!window.confirm("Remove this photo from the public gallery?")) return;
  try {
    await apiFetch(`/api/admin/benches/${encodeURIComponent(benchId)}/images/${encodeURIComponent(imageId)}`, { method: "DELETE" });
    await refreshState();
    toast("Photo removed.");
  } catch (error) { toast(error.message, "error"); }
}

async function reviewRequest(requestId, decision) {
  try {
    await apiFetch(`/api/requests/${encodeURIComponent(requestId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
    await refreshState();
    toast(`Request ${decision === "approve" ? "approved" : "declined"}.`);
  } catch (error) { toast(error.message, "error"); }
}

function switchRoute(route) {
  const needsLogin = route === "admin" && !currentAdmin;
  $("#browse-view").hidden = route !== "browse";
  $("#auth-view").hidden = !needsLogin;
  $("#admin-view").hidden = route !== "admin" || needsLogin;
  $$("[data-route]").forEach((item) => item.classList.toggle("active", item.dataset.route === route));
  if (route === "admin" && currentAdmin) renderAdmin();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function submitAuth(event, endpoint) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $("[data-auth-error]", form);
  const button = $("button[type='submit']", form);
  const values = new FormData(form);
  errorBox.hidden = true;
  button.disabled = true;
  try {
    const result = await apiFetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: values.get("email"), password: values.get("password") }) });
    currentAdmin = result.admin;
    form.reset();
    await refreshState();
    switchRoute("admin");
    toast(endpoint.endsWith("signup") ? "Staff account created." : "Logged in.");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  } finally { button.disabled = false; }
}

async function logout() {
  try { await apiFetch("/api/auth/logout", { method: "POST" }); }
  catch {}
  currentAdmin = null;
  await refreshState();
  switchRoute("admin");
  toast("Logged out.");
}

function clearFilters() {
  filters = { search: "", area: "all", status: "all", photos: "all" };
  currentPage = 1;
  $("#search").value = "";
  $("#area-filter").value = "all";
  $("#status-filter").value = "all";
  $("#photo-filter").value = "all";
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
    if (event.target.id === "photo-filter") filters.photos = event.target.value;
    currentPage = 1; renderBenches();
  });
  $("#filters").addEventListener("reset", (event) => { event.preventDefault(); clearFilters(); });
  $("#admin-record-filters").addEventListener("input", (event) => {
    if (event.target.id === "admin-search") adminFilters.search = event.target.value;
    if (event.target.id === "admin-area-filter") adminFilters.area = event.target.value;
    if (event.target.id === "admin-status-filter") adminFilters.status = event.target.value;
    if (event.target.id === "admin-photo-filter") adminFilters.photos = event.target.value;
    if (event.target.id === "admin-condition-filter") adminFilters.condition = event.target.value;
    adminPage = 1;
    renderAdminRecords();
  });
  $("#admin-record-filters").addEventListener("reset", (event) => { event.preventDefault(); clearAdminFilters(); });
  $("#admin-page-size").addEventListener("change", (event) => { adminPageSize = Number(event.target.value); adminPage = 1; renderAdminRecords(); });
  document.addEventListener("click", (event) => {
    const route = event.target.closest("[data-route]");
    const action = event.target.closest("[data-action]");
    const view = event.target.closest("[data-view]");
    const page = event.target.closest("[data-page]");
    const adminPageButton = event.target.closest("[data-admin-page]");
    const adminSortButton = event.target.closest("[data-admin-sort]");
    const close = event.target.closest("[data-close-dialog]");
    if (route) { event.preventDefault(); switchRoute(route.dataset.route); }
    if (view) {
      viewMode = view.dataset.view;
      try { window.localStorage.setItem("bench-directory-view", viewMode); } catch {}
      renderBenches();
    }
    if (page) { currentPage = Number(page.dataset.page); renderBenches(); $("#browse-heading").scrollIntoView(); }
    if (adminPageButton) { adminPage = Number(adminPageButton.dataset.adminPage); renderAdminRecords(); $("#records-heading").scrollIntoView(); }
    if (adminSortButton) {
      const key = adminSortButton.dataset.adminSort;
      adminSort = { key, direction: adminSort.key === key && adminSort.direction === "asc" ? "desc" : "asc" };
      adminPage = 1;
      renderAdminRecords();
    }
    if (close) close.closest("dialog")?.close();
    if (!action) return;
    if (action.dataset.action === "details") openBench(action.dataset.id);
    if (action.dataset.action === "adopt") openAdoptionForm(action.dataset.id);
    if (action.dataset.action === "clear-filters") clearFilters();
    if (action.dataset.action === "approve" || action.dataset.action === "reject") reviewRequest(action.dataset.id, action.dataset.action);
    if (action.dataset.action === "gallery-photo") showGalleryImage(action.dataset.benchId, action.dataset.imageId, action);
    if (action.dataset.action === "delete-photo") deletePhoto(action.dataset.benchId, action.dataset.imageId);
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
  $("#login-form").addEventListener("submit", (event) => submitAuth(event, "/api/auth/login"));
  $("#signup-form").addEventListener("submit", (event) => submitAuth(event, "/api/auth/signup"));
  $("#logout-button").addEventListener("click", logout);
  $("#photo-upload-form").addEventListener("submit", uploadPhoto);
  $("#photo-bench-select").addEventListener("change", (event) => { selectedPhotoBenchId = event.target.value; renderPhotoManager(); });
  $("#download-template").addEventListener("click", downloadTemplate);
  [$("#bench-dialog"), $("#adoption-dialog"), $("#confirm-dialog")].forEach((dialog) => dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); }));
  try { viewMode = window.localStorage.getItem("bench-directory-view") === "list" ? "list" : "card"; } catch {}
  try {
    const session = await apiFetch("/api/auth/session");
    currentAdmin = session.admin;
    await refreshState();
  }
  catch (error) {
    $("#bench-grid").innerHTML = `<div class="quiet-state"><strong>We couldn’t load the bench directory.</strong><br>${escapeHtml(error.message)} Refresh the page to try again.</div>`;
    $("#result-count").textContent = "Unavailable";
    toast("Could not connect to the bench data service.", "error");
  }
}

initialize();
