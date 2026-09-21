// Server-only first-run seed. These records are inserted into SQLite when the
// benches table is empty; the browser never imports or reads this module.
const AREAS = [
  { name: "Van Cortlandt Lake", feature: "Lake views", prefix: "L" },
  { name: "Parade Ground", feature: "Open lawn", prefix: "P" },
  { name: "Old Croton Aqueduct", feature: "Wooded trail", prefix: "A" },
  { name: "Putnam Trail", feature: "Paved path", prefix: "T" },
  { name: "Nature Center", feature: "Gardens", prefix: "N" },
  { name: "Southwest Playground", feature: "Playground", prefix: "S" },
  { name: "Vault Hill", feature: "Historic area", prefix: "V" },
  { name: "Cross Country Trail", feature: "Forest", prefix: "C" }
];

const dedications = [
  ["The Rivera Family", "In celebration of many happy walks together."],
  ["Friends of the Park", "For everyone who finds peace beneath these trees."],
  ["Anonymous donor", "In memory of a lifelong New Yorker."],
  ["Maya & Theo", "Our favorite place to watch the seasons change."],
  ["The Class of 1998", "Friendship grows here."],
  ["The Chen Family", "With gratitude for this beautiful park."]
];

const requesters = ["Avery Johnson", "Jordan Lee", "Sam Rivera", "Casey Morgan", "Riley Chen", "Taylor Brooks"];

function isoDate(yearOffset, monthOffset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setFullYear(date.getFullYear() + yearOffset);
  date.setMonth(date.getMonth() + monthOffset);
  return date.toISOString().slice(0, 10);
}

export function createSeedData() {
  const benches = Array.from({ length: 520 }, (_, index) => {
    const area = AREAS[index % AREAS.length];
    const areaNumber = Math.floor(index / AREAS.length) + 1;
    const id = `${area.prefix}-${String(areaNumber).padStart(3, "0")}`;
    const adopted = index % 5 === 1 || index % 11 === 3;
    const pending = !adopted && index % 17 === 7;
    let adoption = null;
    if (adopted) {
      const [donorName, dedication] = dedications[index % dedications.length];
      adoption = {
        donorName,
        publicName: donorName,
        dedication,
        startDate: isoDate(-1, -(index % 6)),
        endDate: isoDate(index % 3 === 0 ? 4 : 2, index % 5),
        durationMonths: index % 3 === 0 ? 60 : 36
      };
    }
    return {
      id,
      number: index + 1,
      area: area.name,
      feature: area.feature,
      condition: index % 13 === 0 ? "Needs inspection" : "Good",
      status: adopted ? "adopted" : pending ? "pending" : "available",
      adoption
    };
  });

  const requests = benches.filter((bench) => bench.status === "pending").map((bench, index) => {
    const submittedAt = new Date();
    submittedAt.setDate(submittedAt.getDate() - (index % 12));
    const donorName = requesters[index % requesters.length];
    return {
      id: `REQ-DEMO-${bench.id}`,
      benchId: bench.id,
      donorName,
      email: `${donorName.toLocaleLowerCase().replace(/[^a-z]+/g, ".").replace(/\.$/, "")}@example.com`,
      durationMonths: [12, 36, 60][index % 3],
      dedication: index % 2 ? "For everyone who finds a quiet moment here." : "In celebration of our neighborhood park.",
      showName: index % 4 !== 0,
      status: "pending",
      submittedAt: submittedAt.toISOString()
    };
  });

  return { version: 1, benches, requests, updatedAt: new Date().toISOString() };
}

export { AREAS };
