const selectedYear = 2026;
const selectedMonth = 10;

const start = new Date(selectedYear, selectedMonth - 1, 1, 0, 0, 0, 0);
const end   = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999);

console.log(start:, start.toISOString(), timestamp:, start.getTime());
console.log(end: , end.toISOString(), timestamp:, end.getTime());

const sampleDates = [
  2026-10-01,
  2026-10-02,
  2026-10-12,
  2026-10-14,
  2026-10-23
];

sampleDates.forEach(d => {
  const t = new Date(d).getTime();
  const match = t >= start.getTime() && t <= end.getTime();
  console.log(`Date: ${d} -> parsed UTC: ${new Date(d).toISOString()} -> match: ${match}`);
});
