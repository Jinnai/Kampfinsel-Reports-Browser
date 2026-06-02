export const TRAVEL_TIME_SECONDS_FACTOR = 1282.62225;
export const SPY_SHIP_SPEED = 12;

export type MapCoordinates = {
  ocean: number;
  row: number;
  column: number;
};

export const parseCoordinates = (value: string): MapCoordinates | null => {
  const match = value.trim().match(/^(\d{1,2})\s*:\s*(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (!match) return null;

  return {
    ocean: Number(match[1]),
    row: Number(match[2]),
    column: Number(match[3]),
  };
};

const oceanGridPosition = (ocean: number): { row: number; column: number } => {
  const zeroBasedOcean = ocean - 11;

  return {
    row: Math.floor(zeroBasedOcean / 10),
    column: zeroBasedOcean - Math.floor(zeroBasedOcean / 10) * 10,
  };
};

export const calculateMapDistance = (start: MapCoordinates, end: MapCoordinates): number => {
  const startOcean = oceanGridPosition(start.ocean);
  const endOcean = oceanGridPosition(end.ocean);
  const deltaX = 50 * (endOcean.column - startOcean.column) + (end.column - start.column);
  const deltaY = 50 * (endOcean.row - startOcean.row) + 5 * (end.row - start.row);

  return Math.hypot(deltaX, deltaY);
};

export const calculateTravelDurationMinutes = (distance: number, speed = SPY_SHIP_SPEED): number =>
  Math.max(1, Math.round((distance / speed) * TRAVEL_TIME_SECONDS_FACTOR / 60));
