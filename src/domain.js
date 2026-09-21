export function getEffectiveStatus(bench, today = new Date()) {
  if (bench.status === "adopted" && bench.adoption?.endDate) {
    const end = new Date(`${bench.adoption.endDate}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && end < today) return "available";
  }
  return bench.status;
}

export function filterBenches(benches, { search = "", area = "all", status = "all", photos = "all" }, today = new Date()) {
  const query = search.trim().toLocaleLowerCase();
  return benches.filter((bench) => {
    const haystack = `${bench.id} ${bench.number} ${bench.area} ${bench.feature}`.toLocaleLowerCase();
    return (!query || haystack.includes(query)) &&
      (area === "all" || bench.area === area) &&
      (status === "all" || getEffectiveStatus(bench, today) === status) &&
      (photos === "all" || (photos === "with" ? Boolean(bench.images?.length) : !bench.images?.length));
  });
}

export function getAdminStatus(bench, today = new Date()) {
  if (bench.status === "adopted" && bench.adoption?.endDate) {
    const end = new Date(`${bench.adoption.endDate}T23:59:59`);
    if (!Number.isNaN(end.getTime()) && end < today) return "expired";
  }
  return bench.status;
}

export function filterAdminBenches(benches, { search = "", area = "all", status = "all", photos = "all", condition = "all" }, today = new Date()) {
  const query = search.trim().toLocaleLowerCase();
  return benches.filter((bench) => {
    const haystack = [bench.id, bench.number, bench.area, bench.feature, bench.condition, bench.adoption?.publicName, bench.adoption?.dedication]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return (!query || haystack.includes(query)) &&
      (area === "all" || bench.area === area) &&
      (status === "all" || getAdminStatus(bench, today) === status) &&
      (photos === "all" || (photos === "with" ? Boolean(bench.images?.length) : !bench.images?.length)) &&
      (condition === "all" || bench.condition === condition);
  });
}

export function sortAdminBenches(benches, { key = "number", direction = "asc" }, today = new Date()) {
  const valueFor = (bench) => {
    if (key === "number") return bench.number;
    if (key === "area") return bench.area;
    if (key === "status") return getAdminStatus(bench, today);
    if (key === "photos") return bench.images?.length || 0;
    if (key === "donor") return bench.adoption?.publicName || null;
    if (key === "term") return bench.adoption?.endDate || null;
    return bench.number;
  };
  return [...benches].sort((left, right) => {
    const a = valueFor(left);
    const b = valueFor(right);
    if (a == null && b == null) return left.number - right.number;
    if (a == null) return 1;
    if (b == null) return -1;
    const comparison = typeof a === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
    return (direction === "desc" ? -comparison : comparison) || left.number - right.number;
  });
}

export function validateAdoption(input) {
  const errors = {};
  const name = input.donorName?.trim();
  const email = input.email?.trim();
  const dedication = input.dedication?.trim();
  if (!name) errors.donorName = "Enter your name.";
  if (!email) errors.email = "Enter your email address.";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  if (![12, 36, 60].includes(Number(input.durationMonths))) errors.durationMonths = "Choose an adoption term.";
  if (dedication && dedication.length > 160) errors.dedication = "Keep the dedication to 160 characters or fewer.";
  if (!input.agreed) errors.agreed = "Agree to the program terms to continue.";
  return errors;
}

export function createRequest(bench, input, now = new Date()) {
  if (getEffectiveStatus(bench, now) !== "available") throw new Error("This bench is no longer available.");
  const errors = validateAdoption(input);
  if (Object.keys(errors).length) throw new Error("Please correct the highlighted fields.");
  return {
    id: `REQ-${now.getTime()}`,
    benchId: bench.id,
    donorName: input.donorName.trim(),
    email: input.email.trim().toLocaleLowerCase(),
    durationMonths: Number(input.durationMonths),
    dedication: input.dedication?.trim() || "",
    showName: Boolean(input.showName),
    status: "pending",
    submittedAt: now.toISOString()
  };
}

export function approveRequest(state, requestId, now = new Date()) {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") throw new Error("This request is no longer pending.");
  const bench = state.benches.find((item) => item.id === request.benchId);
  if (!bench || getEffectiveStatus(bench, now) !== "pending") throw new Error("The bench record has changed. Refresh and try again.");
  const end = new Date(now);
  end.setMonth(end.getMonth() + request.durationMonths);
  request.status = "approved";
  request.reviewedAt = now.toISOString();
  bench.status = "adopted";
  bench.adoption = {
    donorName: request.donorName,
    publicName: request.showName ? request.donorName : "Anonymous donor",
    dedication: request.dedication,
    startDate: now.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    durationMonths: request.durationMonths
  };
  return state;
}

export function rejectRequest(state, requestId, now = new Date()) {
  const request = state.requests.find((item) => item.id === requestId);
  if (!request || request.status !== "pending") throw new Error("This request is no longer pending.");
  request.status = "rejected";
  request.reviewedAt = now.toISOString();
  const bench = state.benches.find((item) => item.id === request.benchId);
  if (bench?.status === "pending") bench.status = "available";
  return state;
}

export function formatDate(value) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}
