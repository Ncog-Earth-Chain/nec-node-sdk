const mockMlKem = {
  keyGen: jest.fn(),
  encrypt: jest.fn(),
  decrypt: jest.fn(),
  symEncrypt: jest.fn(),
  symDecrypt: jest.fn(),
  privateKeyToAddress: jest.fn().mockReturnValue('0x1234567890abcdef1234567890abcdef12345678'),
  signTransactionMLDSA87: jest.fn().mockReturnValue({ raw: '0xsignedtx' }),
  decodeRLPTransaction: jest.fn().mockReturnValue({ decoded: true }),
};
jest.mock('../src/webassembly/mlkem', () => {
  return {
    loadWasm: jest.fn().mockResolvedValue(mockMlKem),
  };
});

// Wallet/Signer were refactored to sign via the WASM-free native signer in ./tx-signer (privateKeyToAddress,
// signTransactionMLDSA87, decodeRLPTransaction) instead of the WASM mlkem module. Mock that module so the
// real ML-DSA derivation isn't run against the dummy test key. The mock reuses the same jest.fn()s as
// mockMlKem, so the existing assertions (mockMlKem.signTransactionMLDSA87 / decodeRLPTransaction) still hold.
jest.mock('../src/tx-signer', () => ({
  privateKeyToAddress: mockMlKem.privateKeyToAddress,
  signTransactionMLDSA87: mockMlKem.signTransactionMLDSA87,
  decodeRLPTransaction: mockMlKem.decodeRLPTransaction,
}));


// 👇 Now your imports
import { Wallet, Signer, TxParams } from '../src/wallet';
import type { Provider } from '../src/provider';
// Mock Provider
const mockProvider: jest.Mocked<Provider> = {
  getChainId: jest.fn().mockResolvedValue(1),
  callRpc: jest.fn().mockResolvedValue({ result: '0x1234abcd' }),
  getTransactionCount: jest.fn().mockResolvedValue(1),
  getGasPrice: jest.fn().mockResolvedValue('0x1'),
  // ...other methods can be added as needed
} as any;

describe('Wallet', () => {
  it('creates a Wallet instance from a private key', async () => {
    const wallet = await Wallet.create('0xprivkey');
    expect(wallet).toBeInstanceOf(Wallet);
    expect(wallet.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(wallet.privateKey).toBe('0xprivkey');
  });

  it('connects to a provider and returns a Signer', async () => {
    const wallet = await Wallet.create('0xprivkey');
    const signer = wallet.connect(mockProvider);
    expect(signer).toBeInstanceOf(Signer);
    expect(signer.address).toBe(wallet.address);
  });

  it('Wallet.connect static method returns signer, provider, and address', async () => {
    const result = await Wallet.connect('0xprivkey', 'http://localhost:8545');
    expect(result.address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(result.signer).toBeInstanceOf(Signer);
    expect(result.provider).toBeDefined();
  });
});

describe('Signer', () => {
  let wallet: Wallet;
  let signer: Signer;

  beforeEach(async () => {
    wallet = await Wallet.create('0xprivkey');
    signer = wallet.connect(mockProvider);
  });

  it('returns the correct address', async () => {
    expect(signer.address).toBe(wallet.address);
    await expect(signer.getAddress()).resolves.toBe(wallet.address);
  });

  it('sends a transaction and returns tx hash', async () => {
    const txParams: TxParams = {
      from: wallet.address,
      nonce: 1,
      gasPrice: '0x1',
      gasLimit: '0x5208',
      to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
      value: '0',
      data: '0x',
      chainId: 1,
    };
    const txHash = await signer.sendTransaction(txParams);
    expect(txHash).toBe(305441741);
    expect(mockMlKem.signTransactionMLDSA87).toHaveBeenCalled();
    expect(mockProvider.callRpc).toHaveBeenCalledWith('eth_sendRawTransaction', ['0xsignedtx']);
  });

  it('throws if required tx params are missing', async () => {
    const txParams: any = { to: '', value: '', data: '', gasPrice: '', chainId: 1 };
    await expect(signer.sendTransaction(txParams)).rejects.toThrow('Missing required transaction parameters');
  });

  it('decodes a raw signed transaction', async () => {
    const decoded = await signer.decode('0xsignedtx');
    expect(decoded).toEqual({ decoded: true });
    expect(mockMlKem.decodeRLPTransaction).toHaveBeenCalledWith('0xsignedtx');
  });
}); 