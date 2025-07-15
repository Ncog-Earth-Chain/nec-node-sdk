import { Contract, ISigner, mergeArrayAndKeys, toPlainObject } from '../src/contract';
import { Provider } from '../src/provider';
import axios from 'axios';
jest.mock('axios');

jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  return {
    ...actual,
    Interface: jest.fn().mockImplementation((abi) => {
      return {
        fragments: [
          { type: 'function', name: 'foo', inputs: [], outputs: [{ name: 'result' }] },
        ],
        encodeFunctionData: jest.fn().mockReturnValue('0xencoded'),
        decodeFunctionResult: jest.fn().mockReturnValue([42]),
        getFunction: jest.fn().mockReturnValue({ outputs: [{ name: 'result' }] }),
        encodeDeploy: jest.fn().mockReturnValue('0xencodeddeploy'),
        getEvent: jest.fn().mockReturnValue({ format: () => 'MyEvent()' }),
        parseLog: jest.fn().mockReturnValue({ args: [1, 2] }),
      };
    }),
    utils: {
      id: jest.fn().mockReturnValue('0xtopic'),
    },
  };
});

jest.mock('../src/subscription', () => {
  return {
    Subscription: jest.fn().mockImplementation(() => ({
      connect: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockImplementation((_type, _params, handler) => {
        setTimeout(() => {
          try {
            handler({});
          } catch (e) {}
        }, 0);
        return Promise.resolve('subid');
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
    })),
  };
});

const address = '0x1234567890abcdef1234567890abcdef12345678';

const mockProvider: jest.Mocked<Provider> = {
  call: jest.fn().mockResolvedValue({ result: 42 }),
  sendTransaction: jest.fn().mockResolvedValue('0xsent'),
  estimateGas: jest.fn().mockResolvedValue(21000),
  getTransactionReceipt: jest.fn().mockResolvedValue({ contractAddress: address, status: true }),
} as any;

const mockSigner: ISigner = {
  sendTransaction: jest.fn().mockResolvedValue('0xsignedsent'),
  getAddress: jest.fn().mockResolvedValue('0xsigneraddress'),
};

beforeAll(() => {
  jest.spyOn(global, 'setTimeout').mockImplementation((fn) => {
    fn();
    return 0 as any;
  });
});
afterAll(() => {
  ((setTimeout as unknown) as jest.Mock).mockRestore();
});

describe('mergeArrayAndKeys', () => {
  it('merges named outputs', () => {
    const decoded = [1, 2];
    const outputs = [{ name: 'a' }, { name: 'b' }];
    const result = mergeArrayAndKeys(decoded, outputs);
    expect(result).toEqual({ 0: 1, 1: 2, a: 1, b: 2 });
  });
  it('returns single output directly', () => {
    const decoded = [42];
    const outputs = [{}];
    const result = mergeArrayAndKeys(decoded, outputs);
    expect(result).toBe(42);
  });
  it('returns array if no names', () => {
    const decoded = [1, 2];
    const outputs: any[] = [];
    const result = mergeArrayAndKeys(decoded, outputs);
    expect(result).toEqual([1, 2]);
  });
  it('copies extra properties from decoded', () => {
    const decoded: any = [1, 2];
    decoded.extra = 99;
    const outputs = [{ name: 'a' }, { name: 'b' }];
    const result = mergeArrayAndKeys(decoded, outputs);
    expect(result.extra).toBe(99);
  });
});

describe('toPlainObject', () => {
  it('handles array of structs', () => {
    const result = toPlainObject([[1, 2]], { baseType: 'array', arrayChildren: { baseType: 'tuple', components: [{ name: 'x' }, { name: 'y' }] } });
    expect(result).toEqual([{ x: 1, y: 2 }]);
  });
  it('handles tuple struct', () => {
    const result = toPlainObject([1, 2], { baseType: 'tuple', components: [{ name: 'x' }, { name: 'y' }] });
    expect(result).toEqual({ x: 1, y: 2 });
  });
  it('handles array fallback', () => {
    const result = toPlainObject([1, 2]);
    expect(result).toEqual([1, 2]);
  });
  it('handles object', () => {
    const result = toPlainObject({ foo: 1, bar: 2 });
    expect(result).toEqual({ foo: 1, bar: 2 });
  });
  it('handles primitive', () => {
    const result = toPlainObject(42);
    expect(result).toBe(42);
  });
});

describe('Contract', () => {
  const abi = [
    { type: 'function', name: 'foo', inputs: [], outputs: [{ name: 'result' }] },
  ];
  const address = '0x1234567890abcdef1234567890abcdef12345678';

  it('initializes with methods and events', () => {
    const contract = new Contract(address, abi, mockProvider);
    expect(contract.address).toBe(address);
    expect(contract.methods.foo).toBeDefined();
  });

  it('calls a contract method', async () => {
    const contract = new Contract(address, abi, mockProvider);
    const result = await contract.methods.foo().call();
    expect(result).toEqual({ result: 42 });
    expect(mockProvider.call).toHaveBeenCalled();
  });

  it('sends a contract method with signer', async () => {
    const contract = new Contract(address, abi, mockProvider, mockSigner);
    const result = await contract.methods.foo().send({});
    expect(result).toBe('0xsignedsent');
    expect(mockSigner.sendTransaction).toHaveBeenCalled();
  });

  it('sends a contract method without signer (provider fallback)', async () => {
    const contract = new Contract(address, abi, mockProvider);
    const result = await contract.methods.foo().send({});
    expect(result).toBe('0xsent');
    expect(mockProvider.sendTransaction).toHaveBeenCalled();
  });

  it('estimates gas for a contract method', async () => {
    const contract = new Contract(address, abi, mockProvider);
    const result = await contract.methods.foo().estimateGas();
    expect(result).toBe(21000);
    expect(mockProvider.estimateGas).toHaveBeenCalled();
  });

  it('deploys a contract', async () => {
    const deployer = mockSigner;
    const deploySpy = jest.spyOn(mockSigner, 'sendTransaction').mockResolvedValue('0xdeployed');
    const result = await Contract.deploy({
      abi,
      bytecode: '0xbytecode',
      provider: mockProvider,
      deployer,
      constructorArgs: [],
      options: {},
    });
    expect(result).toHaveProperty('contractAddress');
    expect(deploySpy).toHaveBeenCalled();
  });
});

describe('Contract.deploy', () => {
  const abi = [
    { type: 'function', name: 'foo', inputs: [], outputs: [{ name: 'result' }] },
  ];
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  const provider: any = {
    sendTransaction: jest.fn().mockResolvedValue('0xhash'),
    getTransactionReceipt: jest.fn().mockResolvedValue({ contractAddress: address, status: true }),
  };
  const signer: ISigner = {
    sendTransaction: jest.fn().mockResolvedValue('0xhash'),
  };

  it('throws if deployer is invalid', async () => {
    await expect(Contract.deploy({ abi, bytecode: '0x', provider, deployer: null as any })).rejects.toThrow('Invalid deployer');
  });

  it('throws if contract address not found in receipt', async () => {
    provider.getTransactionReceipt = jest.fn().mockResolvedValue(null);
    await expect(Contract.deploy({ abi, bytecode: '0x', provider, deployer: signer })).rejects.toThrow('Deployment transaction was not mined or contract address not found in receipt.');
  });
});

describe('Contract.verify', () => {
  it('calls axios.post with correct payload', async () => {
    (axios.post as jest.Mock).mockResolvedValue({ data: { status: 'ok' } });
    const params = {
      apiUrl: 'http://api',
      apiKey: 'key',
      contractAddress: '0xabc',
      sourceCode: 'code',
      contractName: 'C',
      compilerVersion: 'v',
    };
    const result = await Contract.verify(params);
    expect(axios.post).toHaveBeenCalledWith('http://api', expect.objectContaining({ contractaddress: '0xabc' }));
    expect(result).toEqual({ status: 'ok' });
  });
});

describe('EventStream', () => {
  const contract: any = {
    abiInterface: {
      getEvent: jest.fn().mockReturnValue({ format: () => 'MyEvent()' }),
      parseLog: jest.fn().mockReturnValue({ args: [1, 2] }),
    },
    address: '0xabc',
    provider: { url: 'http://localhost:8545' },
  };
  let eventStream: any;

  beforeEach(() => {
    eventStream = new (require('../src/contract').EventStream)(contract, 'MyEvent', {});
  });

  it('registers and unregisters event handlers', () => {
    const handler = jest.fn();
    eventStream.on('data', handler);
    eventStream.emit('data', { foo: 1 });
    expect(handler).toHaveBeenCalledWith({ foo: 1 });
    eventStream.off('data', handler);
    eventStream.emit('data', { foo: 2 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('emits error if event fragment not found', async () => {
    eventStream.contract.abiInterface.getEvent = jest.fn().mockReturnValue(undefined);
    const errorHandler = jest.fn();
    eventStream.on('error', errorHandler);
    await eventStream.start();
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });

  it('calls stop and disconnects subscription', async () => {
    eventStream.subscription = { disconnect: jest.fn().mockResolvedValue(undefined) };
    await eventStream.stop();
    expect(eventStream.subscription).toBeUndefined();
  });
});

describe('Contract.call edge cases', () => {
  const abi = [
    { type: 'function', name: 'foo', inputs: [], outputs: [{ name: 'result' }] },
  ];
  const address = '0x1234567890abcdef1234567890abcdef12345678';
  let contract: any;
  let provider: any;
  beforeEach(() => {
    provider = {
      call: jest.fn(),
    };
    contract = new Contract(address, abi, provider);
    contract.abiInterface.encodeFunctionData = jest.fn().mockReturnValue('0xencoded');
    contract.abiInterface.getFunction = jest.fn().mockReturnValue({ outputs: [{ name: 'result' }] });
    contract.abiInterface.decodeFunctionResult = jest.fn().mockReturnValue([42]);
  });
  it('handles result 0 as 0x', async () => {
    provider.call.mockResolvedValue(0);
    const result = await contract.call('foo');
    expect(result).toEqual([]);
  });
  it('handles result as 0x and outputs present', async () => {
    provider.call.mockResolvedValue('0x');
    const result = await contract.call('foo');
    expect(result).toEqual([]);
  });
  it('handles result as 0x0 and outputs present', async () => {
    provider.call.mockResolvedValue('0x0');
    const result = await contract.call('foo');
    expect(result).toEqual([]);
  });
  it('handles result as empty string and outputs present', async () => {
    provider.call.mockResolvedValue('');
    const result = await contract.call('foo');
    expect(result).toEqual([]);
  });
});

describe('EventStream error handling in log subscription', () => {
  it('emits error if parseLog throws', async () => {
    const contract: any = {
      abiInterface: {
        getEvent: jest.fn().mockReturnValue({ format: () => 'MyEvent()' }),
        parseLog: jest.fn().mockImplementation(() => { throw new Error('parse error'); }),
      },
      address: '0xabc',
      provider: { url: 'http://localhost:8545' },
    };
    const eventStream = new (require('../src/contract').EventStream)(contract, 'MyEvent', {});
    const errorHandler = jest.fn();
    eventStream.on('error', errorHandler);
    await eventStream.start().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });
}); 