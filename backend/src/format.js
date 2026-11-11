export function campusNow(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
export const clock = (value) => String(value || "").slice(0, 5);
export const displayDate = (value) => {
  const date = new Date(String(value).slice(0, 10) + "T00:00:00Z");
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
};
export const dateDay = (value) => String(value).slice(8, 10);
export const dateMonth = (value) =>
  new Date(String(value).slice(0, 10) + "T00:00:00Z").toLocaleDateString("en", {
    month: "short",
    timeZone: "UTC",
  });
export const fixed = (value) => Number(value).toFixed(2);
