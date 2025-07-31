import { Provider, RpcError } from '../src/provider';
import axios, { AxiosError } from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('Provider', () => {
  const url = 'http://localhost:8545';
  let provider: Provider;

  beforeEach(() => {
    provider = new Provider(url);
    mockedAxios.post.mockReset();
  });

  it('should throw if URL is not set', async () => {
    // @ts-ignore
    provider = new Provider('');
    await expect(provider.callRpc('eth_chainId')).rejects.toThrow('Provider URL is not set');
  });

  it('should make a raw rpc call and return normalized response', async () => {
    mockedAxios.post.mockResolvedValue({ data: { result: '0x1' } });
    const result = await provider.callRpc('eth_chainId');
    expect(result).toBe(1);
    expect(mockedAxios.post).toHaveBeenCalledWith(url, expect.any(Object));
  });

  it('should throw RpcError on JSON-RPC error', async () => {
    mockedAxios.post.mockResolvedValue({ data: { error: { message: 'fail', code: -32000 } } });
    await expect(provider.callRpc('eth_chainId')).rejects.toThrow(RpcError);
  });

  it('should handle network errors', async () => {
    const error = new AxiosError('Network error');
    error.message = 'Network error';
    mockedAxios.post.mockRejectedValue(error);
    await expect(provider.callRpc('eth_chainId')).rejects.toThrow('RPC request failed for method "eth_chainId": Network error');
  });

  it('should throw other errors in rpc', async () => {
    mockedAxios.post.mockRejectedValue(new Error('Other error'));
    await expect(provider.callRpc('eth_chainId')).rejects.toThrow('Other error');
  });

  it('should call batchRpc and return results', async () => {
    mockedAxios.post.mockResolvedValue({ data: [
      { id: 1, result: '0x1' },
      { id: 2, result: '0x2' },
    ] });
    const results = await provider.batchRpc([
      { method: 'eth_chainId' },
      { method: 'eth_blockNumber' },
    ]);
    expect(results).toEqual([1, 2]);
  });

  it('should call batchRpc and handle errors', async () => {
    mockedAxios.post.mockRejectedValue(new Error('fail'));
    const results = await provider.batchRpc([
      { method: 'eth_chainId' },
      { method: 'eth_blockNumber' },
    ]);
    expect(results[0].error).toBe('fail');
    expect(results[1].error).toBe('fail');
  });

  it('should throw if URL is not set in batchRpc', async () => {
    // @ts-ignore
    provider = new Provider('');
    await expect(provider.batchRpc([{ method: 'foo' }])).rejects.toThrow('Provider URL is not set');
  });

  it('should apply request and response middleware in batchRpc', async () => {
    const reqMw = jest.fn(async (payload) => ({ ...payload, test: true }));
    const resMw = jest.fn(async (response) => ({ ...response, test: true }));
    provider.useRequest(reqMw);
    provider.useResponse(resMw);
    mockedAxios.post.mockResolvedValue({ data: [
      { id: 1, result: '0x1' },
      { id: 2, result: '0x2' },
    ] });
    await provider.batchRpc([
      { method: 'eth_chainId' },
      { method: 'eth_blockNumber' },
    ]);
    expect(reqMw).toHaveBeenCalled();
    expect(resMw).toHaveBeenCalled();
  });

  it('should call all public RPC methods', async () => {
    mockedAxios.post.mockResolvedValue({ data: { result: '0x1' } });
    await expect(provider.clientVersion()).resolves.toBe(1);
    await expect(provider.netVersion()).resolves.toBe(1);
    await expect(provider.listening()).resolves.toBe(1);
    await expect(provider.peerCount()).resolves.toBe(1);
    await expect(provider.protocolVersion()).resolves.toBe(1);
    await expect(provider.syncing()).resolves.toBe(1);
    await expect(provider.coinbase()).resolves.toBe(1);
    await expect(provider.hashrate()).resolves.toBe(1);
    await expect(provider.getChainId()).resolves.toBe(1);
    await expect(provider.getGasPrice()).resolves.toBe(1);
    await expect(provider.accounts()).resolves.toBe(1);
    await expect(provider.getBlockNumber()).resolves.toBe(1);
    await expect(provider.getBalance('0xabc')).resolves.toBe(1e-18);
    await expect(provider.getStorageAt('0xabc', '0x0')).resolves.toBe(1);
    await expect(provider.getTransactionCount('0xabc')).resolves.toBe(1);
    await expect(provider.getBlockTransactionCountByNumber('latest')).resolves.toBe(1);
    await expect(provider.getCode('0xabc')).resolves.toBe(1);
    await expect(provider.getBlockByNumber('latest')).resolves.toBe(1);
    await expect(provider.getBlockByHash('0xhash')).resolves.toBe(1);
    await expect(provider.sign('0xabc', '0xdata')).resolves.toBe(1);
    await expect(provider.signTransaction({})).resolves.toBe(1);
    await expect(provider.sendTransaction({})).resolves.toBe(1);
    await expect(provider.sendRawTransaction('0xsigned')).resolves.toBe(1);
    await expect(provider.call({ to: '0xabc' })).resolves.toBe(1);
    await expect(provider.estimateGas({})).resolves.toBe(1);
    await expect(provider.getTransactionByHash('0xhash')).resolves.toBe(1);
    await expect(provider.getTransactionReceipt('0xhash')).resolves.toBe(1);
    await expect(provider.getLogs({})).resolves.toBe(1);
    await expect(provider.submitWork('0x1', '0x2', '0x3')).resolves.toBe(1);
    await expect(provider.getWork()).resolves.toBe(1);
    await expect(provider.newAccount('pw')).resolves.toBe(1);
    await expect(provider.importRawKey('key', 'pw')).resolves.toBe(1);
    await expect(provider.personalSign('data', '0xabc', 'pw')).resolves.toBe(1);
    await expect(provider.ecRecover('data', 'sig')).resolves.toBe(1);
    await expect(provider.unlockAccount('0xabc', 'pw')).resolves.toBe(1);
    await expect(provider.lockAccount('0xabc')).resolves.toBe(1);
    await expect(provider.sendPersonalTransaction({}, 'pw')).resolves.toBe(1);
  });

  it('should throw error from response middleware in rpc', async () => {
    const resMw = jest.fn().mockImplementation(() => { throw new Error('mw error'); });
    provider.useResponse(resMw);
    mockedAxios.post.mockResolvedValue({ data: { result: '0x1' } });
    await expect(provider.callRpc('eth_chainId')).rejects.toThrow('mw error');
  });

  it('should handle response middleware in batchRpc', async () => {
    const resMw = jest.fn(async (response) => ({ ...response, test: true }));
    provider.useResponse(resMw);
    mockedAxios.post.mockResolvedValue({ data: [
      { id: 1, result: '0x1' },
      { id: 2, result: '0x2' },
    ] });
    const results = await provider.batchRpc([
      { method: 'eth_chainId' },
      { method: 'eth_blockNumber' },
    ]);
    expect(resMw).toHaveBeenCalled();
    expect(results).toEqual([1, 2]);
  });

  it('should throw if URL is not set in rpc (direct)', async () => {
    // @ts-ignore
    provider = new Provider('');
    // @ts-ignore
    await expect(provider.rpc('eth_chainId')).rejects.toThrow('Provider URL is not set');
  });

  it('should throw if URL is not set in batchRpc (direct)', async () => {
    // @ts-ignore
    provider = new Provider('');
    await expect(provider.batchRpc([{ method: 'foo' }])).rejects.toThrow('Provider URL is not set');
  });

  it('should handle catch block in batchRpc', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('batch error'));
    const results = await provider.batchRpc([{ method: 'foo' }]);
    expect(results[0].error).toBe('batch error');
  });

  describe('resolveEnsName', () => {
    let provider: Provider;
    beforeEach(() => {
      provider = new Provider(url);
      jest.resetModules();
    });
    it('returns address on success', async () => {
      jest.doMock('ethers', () => ({ namehash: jest.fn().mockReturnValue('0xnode') }));
      provider.call = jest.fn()
        .mockResolvedValueOnce('0xresolver')
        .mockResolvedValueOnce('0xaddress');
      const result = await provider.resolveEnsName('foo.eth');
      expect(result).toBe('0xaddress');
    });
    it('returns null if resolver not found', async () => {
      jest.mock('ethers', () => ({ utils: { namehash: jest.fn().mockReturnValue('0xnode') } }));
      provider.call = jest.fn().mockResolvedValueOnce('0x');
      const result = await provider.resolveEnsName('foo.eth');
      expect(result).toBeNull();
    });
    it('returns null if address not found', async () => {
      jest.mock('ethers', () => ({ utils: { namehash: jest.fn().mockReturnValue('0xnode') } }));
      provider.call = jest.fn()
        .mockResolvedValueOnce('0xresolver')
        .mockResolvedValueOnce('0x');
      const result = await provider.resolveEnsName('foo.eth');
      expect(result).toBeNull();
    });
    it('returns null on error', async () => {
      provider.call = jest.fn().mockRejectedValue(new Error('fail'));
      const result = await provider.resolveEnsName('foo.eth');
      expect(result).toBeNull();
    });
  });
}); 