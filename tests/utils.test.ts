import {
  hexToDecimalString,
  normalizeHexField,
  decimalToHex,
  etherToWeiHex,
  valueToNineDecimalHex,
  formatUnits,
  serializeForRpc,
  normalizeResponse,
  isValidAddress,
} from '../src/utils';

describe('utils', () => {
  describe('hexToDecimalString', () => {
    it('converts hex to decimal', () => {
      expect(hexToDecimalString('0x2a')).toBe(42);
      expect(hexToDecimalString('2a')).toBe(42);
      expect(hexToDecimalString('0x')).toBe(0);
    });
    it('throws on invalid hex', () => {
      expect(() => hexToDecimalString('xyz')).toThrow();
    });
  });

  describe('normalizeHexField', () => {
    it('normalizes amount/balance fields with 9 decimals', () => {
      expect(normalizeHexField('amount', '0x1')).toBe('1');
      expect(normalizeHexField('balance', '0x2')).toBe('2');
    });
    it('normalizes other fields as decimal', () => {
      expect(normalizeHexField('foo', '0x2a')).toBe('42');
    });
  });

  describe('decimalToHex', () => {
    it('converts decimal to hex', () => {
      expect(decimalToHex(42)).toBe('0x2a');
      expect(decimalToHex('42')).toBe('0x2a');
    });
  });

  describe('etherToWeiHex', () => {
    it('converts ether to wei hex', () => {
      expect(etherToWeiHex(1)).toBe('0xde0b6b3a7640000');
    });
  });

  describe('valueToNineDecimalHex', () => {
    it('converts value to 9-decimal hex', () => {
      expect(valueToNineDecimalHex(2)).toBe('0x77359400');
    });
  });

  describe('formatUnits', () => {
    it('formats value with 9 decimals', () => {
      expect(formatUnits('1000000000')).toBe('1');
    });
    it('formats value with 18 decimals', () => {
      expect(formatUnits('1000000000000000000', 18)).toBe('1');
    });
  });

  describe('serializeForRpc', () => {
    it('serializes payload for RPC', () => {
      expect(serializeForRpc({ value: 1, foo: 2, amount: 3 })).toEqual({
        value: '0xde0b6b3a7640000',
        foo: '0x2',
        amount: '0xb2d05e00',
      });
    });
  });

  describe('normalizeResponse', () => {
    it('normalizes hex string', () => {
      expect(normalizeResponse('0x2a')).toBe(42);
    });
    it('normalizes array', () => {
      expect(normalizeResponse(['0x2a', '0x1'])).toEqual(["0x2a", "0x1"]);
    });
    it('normalizes object', () => {
      expect(normalizeResponse({ foo: '0x2a', address: '0x1234567890abcdef1234567890abcdef12345678' })).toEqual({ foo: '42', address: '0x1234567890abcdef1234567890abcdef12345678' });
    });
  });

  describe('isValidAddress', () => {
    it('validates correct address', () => {
      expect(isValidAddress('0x1234567890abcdef1234567890abcdef12345678')).toBe(true);
    });
    it('invalidates incorrect address', () => {
      expect(isValidAddress('0x123')).toBe(false);
      expect(isValidAddress('notanaddress')).toBe(false);
    });
  });
}); 