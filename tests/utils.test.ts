import {
  hexToDecimalString,
  normalizeHexField,
  decimalToHex,
  etherToWeiHex,
  formatUnits,
  serializeForRpc,
  normalizeResponse,
  isValidAddress,
  DEFAULT_DECIMALS,
  NEC_DECIMALS,
  WEI_FACTOR,
  decimalToWei,
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
      expect(etherToWeiHex(1)).toBe('0x' + WEI_FACTOR.toString(16));
    });
  });

  describe('formatUnits', () => {
    it('formats value with 18 decimals', () => {
      const value = (BigInt(1) * (BigInt(10) ** BigInt(DEFAULT_DECIMALS))).toString();
      expect(formatUnits(value, DEFAULT_DECIMALS)).toBe('1');
    });
    it('formats value with NEC decimals', () => {
      const value = (BigInt(1) * (BigInt(10) ** BigInt(NEC_DECIMALS))).toString();
      expect(formatUnits(value, NEC_DECIMALS)).toBe('1');
    });
  });

  describe('serializeForRpc', () => {
    it('serializes payload for RPC', () => {
      const expectedAmount = '0x' + (BigInt(3) * (BigInt(10) ** BigInt(DEFAULT_DECIMALS))).toString(16);
      expect(serializeForRpc({ value: 1, foo: 2, amount: 3 })).toEqual({
        value: '0xde0b6b3a7640000',
        foo: '0x2',
        amount: expectedAmount,
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

  describe('decimalToWei', () => {
    it('converts integer ether to wei string', () => {
      expect(decimalToWei(1)).toBe('1000000000000000000');
      expect(decimalToWei('2')).toBe('2000000000000000000');
      expect(decimalToWei(BigInt(3))).toBe('3000000000000000000');
    });
    it('converts fractional ether to wei string', () => {
      expect(decimalToWei(1.23)).toBe('1230000000000000000');
      expect(decimalToWei('0.5')).toBe('500000000000000000');
      expect(decimalToWei('0.000000000000000001')).toBe('1');
    });
    it('supports custom decimals', () => {
      expect(decimalToWei('1', 6)).toBe('1000000');
      expect(decimalToWei('0.123456', 6)).toBe('123456');
    });
    it('throws on invalid input', () => {
      expect(() => decimalToWei({} as any)).toThrow();
      expect(() => decimalToWei([] as any)).toThrow();
      expect(() => decimalToWei('abc')).toThrow();
    });
  });
}); 