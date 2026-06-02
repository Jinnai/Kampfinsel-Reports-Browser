import { describe, expect, it } from 'vitest';
import { calculateMapDistance, parseCoordinates } from './travel';

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
});
