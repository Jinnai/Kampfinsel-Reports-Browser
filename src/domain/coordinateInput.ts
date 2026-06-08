export const formatCoordinateInput = (value: string): string => {
  if (value.split(':').length >= 3) return value;

  const digits = value.replace(/\D/g, '');
  if (digits.length <= 2) return digits;

  const ocean = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length === 1) return `${ocean}:${rest}`;
  if (rest === '10') return `${ocean}:10`;
  if (rest.length === 2) return `${ocean}:${rest.slice(0, 1)}:${rest.slice(1)}`;

  if (rest.startsWith('10')) {
    return `${ocean}:10:${rest.slice(2)}`;
  }

  return `${ocean}:${rest.slice(0, 1)}:${rest.slice(1)}`;
};
