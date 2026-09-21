const REQUIRED_COLUMNS = ["bench_id", "number", "area"];
const VALID_STATUSES = new Set(["available", "adopted"]);

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(value); value = ""; }
    else if (char === "\n") { row.push(value); rows.push(row); row = []; value = ""; }
    else if (char !== "\r") value += char;
  }
  if (quoted) throw new Error("The CSV contains an unclosed quoted value.");
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows.filter((values) => values.some((item) => item.trim()));
}

export function parseBenchInventory(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("The CSV must include a header and at least one bench.");
  const headers = rows[0].map((header) => header.trim().toLocaleLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!headers.includes(column)) throw new Error(`Missing required column: ${column}`);
  }
  const seen = new Set();
  const seenNumbers = new Set();
  return rows.slice(1).map((values, rowIndex) => {
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""]));
    const line = rowIndex + 2;
    const number = Number(record.number);
    const status = record.status?.toLocaleLowerCase() || "available";
    if (!record.bench_id) throw new Error(`Row ${line}: bench_id is required.`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,49}$/.test(record.bench_id)) throw new Error(`Row ${line}: bench_id may contain only letters, numbers, hyphens, and underscores.`);
    if (seen.has(record.bench_id)) throw new Error(`Row ${line}: duplicate bench_id ${record.bench_id}.`);
    if (!Number.isInteger(number) || number < 1) throw new Error(`Row ${line}: number must be a positive whole number.`);
    if (seenNumbers.has(number)) throw new Error(`Row ${line}: duplicate bench number ${number}.`);
    if (!record.area) throw new Error(`Row ${line}: area is required.`);
    if (!VALID_STATUSES.has(status)) throw new Error(`Row ${line}: status must be available or adopted.`);
    if (status === "adopted" && (!record.start_date || !record.end_date)) throw new Error(`Row ${line}: adopted benches require start_date and end_date.`);
    if (status === "adopted" && (![record.start_date, record.end_date].every(isIsoDate))) throw new Error(`Row ${line}: dates must use a valid YYYY-MM-DD calendar date.`);
    if (status === "adopted" && record.end_date < record.start_date) throw new Error(`Row ${line}: end_date must be after start_date.`);
    seen.add(record.bench_id);
    seenNumbers.add(number);
    return {
      id: record.bench_id,
      number,
      area: record.area,
      feature: record.feature || "",
      condition: record.condition || "Good",
      status,
      adoption: status === "adopted" ? {
        donorName: record.donor_name || record.public_name || "Unknown",
        publicName: record.public_name || "Anonymous donor",
        dedication: record.dedication || "",
        startDate: record.start_date,
        endDate: record.end_date,
        durationMonths: Number(record.duration_months) || null
      } : null
    };
  });
}

export const CSV_TEMPLATE = "bench_id,number,area,feature,condition,status,donor_name,public_name,dedication,start_date,end_date,duration_months\nL-001,1,Van Cortlandt Lake,Lake views,Good,available,,,,,,\n";
