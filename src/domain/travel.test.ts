import { describe, expect, it } from 'vitest';
import { calculateMapDistance, calculateNauticalMiles, parseCoordinates } from './travel';

const coords = (value: string) => {
  const parsed = parseCoordinates(value);
  if (!parsed) throw new Error(`Invalid coordinates in test: ${value}`);
  return parsed;
};

describe('travel distance', () => {
  it('keeps oceans 11 through 20 horizontally adjacent', () => {
    expect(calculateMapDistance(coords('11:1:1'), coords('12:1:1'))).toBeCloseTo(50, 12);
    expect(calculateMapDistance(coords('11:1:1'), coords('20:1:1'))).toBeCloseTo(450, 12);
  });

  it('places oceans 21 through 30 below oceans 11 through 20', () => {
    expect(calculateMapDistance(coords('11:1:1'), coords('21:1:1'))).toBeCloseTo(50, 12);
    expect(calculateMapDistance(coords('20:1:1'), coords('21:1:1'))).toBeCloseTo(Math.hypot(-450, 50), 12);
    expect(calculateMapDistance(coords('17:7:8'), coords('27:7:8'))).toBeCloseTo(50, 12);
  });

  it('converts map distance to nautical miles', () => {
    expect(calculateNauticalMiles(coords('13:5:20'), coords('14:5:20'))).toBeCloseTo(20, 12);
    expect(calculateNauticalMiles(coords('13:5:20'), coords('13:5:21'))).toBeCloseTo(0.4, 12);
    expect(calculateNauticalMiles(coords('13:5:20'), coords('13:6:20'))).toBeCloseTo(2, 12);
  });
});
