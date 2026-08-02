export const RECENT_DATA_WINDOW_MS = 48 * 60 * 60 * 1000;
const FUTURE_CLOCK_TOLERANCE_MS = 6 * 60 * 60 * 1000;

export const parseObservationTime = (value: string) =>
  Date.parse(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value)
      ? `${value}Z`
      : value,
  );

export const isRecentObservation = (
  value: string | null | undefined,
  referenceTime: number,
) => {
  if (!value || !Number.isFinite(referenceTime)) return false;
  const observedAt = parseObservationTime(value);
  if (!Number.isFinite(observedAt)) return false;
  const age = referenceTime - observedAt;
  return age >= -FUTURE_CLOCK_TOLERANCE_MS && age <= RECENT_DATA_WINDOW_MS;
};
