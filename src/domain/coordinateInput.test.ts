import { describe, expect, it } from 'vitest';
import { formatCoordinateInput } from './coordinateInput';

describe('formatCoordinateInput', () => {
  it('inserts separators for numeric mobile keyboard input', () => {
    expect(formatCoordinateInput('1778')).toBe('17:7:8');
    expect(formatCoordinateInput('15413')).toBe('15:4:13');
    expect(formatCoordinateInput('11102')).toBe('11:10:2');
    expect(formatCoordinateInput('111025')).toBe('11:10:25');
  });

  it('keeps manually separated coordinates editable', () => {
    expect(formatCoordinateInput('17:7:8')).toBe('17:7:8');
  });

  it('reformats values that already have one inserted separator while typing', () => {
    expect(formatCoordinateInput('17:78')).toBe('17:7:8');
    expect(formatCoordinateInput('11:102')).toBe('11:10:2');
  });

  it('ignores non-digit characters before inserting separators', () => {
    expect(formatCoordinateInput('15 4 13')).toBe('15:4:13');
  });
});
