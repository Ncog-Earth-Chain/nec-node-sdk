import axios from 'axios';
import { getAllTransactions, getAllTokens, GraphqlParams, TokenParams } from './graphql';
import * as utils from './utils';

jest.mock('axios');

// Mock utils
jest.mock('./utils', () => ({
  hexToEther: jest.fn((x) => `ether(${x})`),
  hexToDecimalString: jest.fn((x) => `dec(${x})`),
}));

describe('getAllTransactions', () => {
  const url = 'http://mock/graphql';
  const variables = { address: '0xabc', count: 2 };
  const params: GraphqlParams = { url, variables };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw if url is missing', async () => {
    await expect(getAllTransactions({ ...params, url: '' })).rejects.toThrow('"url" is a required string parameter.');
  });

  it('should throw if variables is missing', async () => {
    await expect(getAllTransactions({ ...params, variables: undefined as any })).rejects.toThrow('"variables" is a required object parameter.');
  });

  it('should throw if address is missing', async () => {
    await expect(getAllTransactions({ ...params, variables: { ...variables, address: '' } })).rejects.toThrow('"variables.address" is a required string parameter.');
  });

  it('should throw if count is not a number', async () => {
    await expect(getAllTransactions({ ...params, variables: { ...variables, count: undefined as any } })).rejects.toThrow('"variables.count" must be a number.');
  });

  it('should return normalized account data', async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          account: {
            balance: '0x1',
            totalValue: '0x2',
            txCount: '0x3',
            txList: {
              totalCount: '0x4',
              edges: [
                {
                  transaction: {
                    value: '0x5',
                    gasUsed: '0x6',
                    block: { number: '0x7', timestamp: '0x8' },
                    tokenTransactions: [
                      { amount: '0x9' }
                    ]
                  }
                }
              ]
            },
            delegations: {
              totalCount: '0xa',
              edges: [
                {
                  delegation: {
                    amount: '0xb',
                    claimedReward: '0xc',
                    pendingRewards: [ { amount: '0xd' } ]
                  }
                }
              ]
            },
            staker: {
              createdTime: '0xe',
              totalCount: '0xf',
              totalValue: '0x10',
              totalRewards: '0x11',
              totalStaked: '0x12',
              totalUnstaked: '0x13',
            }
          }
        }
      }
    });
    const result = await getAllTransactions(params);
    expect(result.balance).toBe('ether(0x1)');
    expect(result.totalValue).toBe('ether(0x2)');
    expect(result.txCount).toBe('dec(0x3)');
    expect(result.txList.totalCount).toBe('dec(0x4)');
    expect(result.txList.edges[0].transaction.value).toBe('ether(0x5)');
    expect(result.txList.edges[0].transaction.gasUsed).toBe('dec(0x6)');
    expect(result.txList.edges[0].transaction.block.number).toBe('dec(0x7)');
    expect(result.txList.edges[0].transaction.block.timestamp).toBe('dec(0x8)');
    expect(result.txList.edges[0].transaction.tokenTransactions[0].amount).toBe('ether(0x9)');
    expect(result.delegations.totalCount).toBe('dec(0xa)');
    expect(result.delegations.edges[0].delegation.amount).toBe('ether(0xb)');
    expect(result.delegations.edges[0].delegation.claimedReward).toBe('ether(0xc)');
    expect(result.delegations.edges[0].delegation.pendingRewards[0].amount).toBe('ether(0xd)');
    expect(result.staker.createdTime).toBe('dec(0xe)');
    expect(result.staker.totalCount).toBe('dec(0xf)');
    expect(result.staker.totalValue).toBe('ether(0x10)');
    expect(result.staker.totalRewards).toBe('ether(0x11)');
    expect(result.staker.totalStaked).toBe('ether(0x12)');
    expect(result.staker.totalUnstaked).toBe('ether(0x13)');
  });

  it('should throw and log on axios error', async () => {
    const error = { message: 'fail', response: { data: 'errordata' } };
    (axios.post as jest.Mock).mockRejectedValue(error);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getAllTransactions(params)).rejects.toEqual(error);
    expect(spy).toHaveBeenCalledWith('GraphQL API call failed:', 'fail');
    expect(spy).toHaveBeenCalledWith('Response data:', 'errordata');
    spy.mockRestore();
  });
});

describe('getAllTokens', () => {
  const url = 'http://mock/graphql';
  const variables = { address: '0xabc' };
  const params: TokenParams = { url, variables };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should throw if url is missing', async () => {
    await expect(getAllTokens({ ...params, url: '' })).rejects.toThrow('"url" is a required string parameter.');
  });

  it('should throw if address is missing', async () => {
    await expect(getAllTokens({ ...params, variables: { address: undefined as any } })).rejects.toThrow('"variables.address" is a required string parameter.');
  });

  it('should return normalized token amounts', async () => {
    (axios.post as jest.Mock).mockResolvedValue({
      data: {
        data: {
          account: {
            tokenSummaries: [
              { amount: '0x1' },
              { amount: '0x2' }
            ]
          }
        }
      }
    });
    const result = await getAllTokens(params);
    expect(result.tokenSummaries[0].amount).toBe('ether(0x1)');
    expect(result.tokenSummaries[1].amount).toBe('ether(0x2)');
  });

  it('should throw and log on axios error', async () => {
    const error = { message: 'fail', response: { data: 'errordata' } };
    (axios.post as jest.Mock).mockRejectedValue(error);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(getAllTokens(params)).rejects.toEqual(error);
    expect(spy).toHaveBeenCalledWith('Token API call failed:', 'fail');
    expect(spy).toHaveBeenCalledWith('Response data:', 'errordata');
    spy.mockRestore();
  });
}); 