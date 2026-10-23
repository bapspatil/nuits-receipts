import { describe, expect, it } from 'vitest';
import { currencyCode } from '../src/ai';

describe('currencyCode', () => {
  it('keeps printed ISO codes and maps bare symbols', () => {
    expect(currencyCode('EUR')).toBe('EUR');
    expect(currencyCode('eur 52.84')).toBe('EUR');
    expect(currencyCode('€')).toBe('EUR');
    expect(currencyCode(')$')).toBe('USD');
    expect(currencyCode('£')).toBe('GBP');
  });
  it('returns null when nothing recognisable was printed', () => {
    expect(currencyCode(null)).toBeNull();
    expect(currencyCode('??')).toBeNull();
  });
});
