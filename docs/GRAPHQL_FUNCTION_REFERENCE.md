# GraphQL Function Reference

This document provides detailed information about all functions available in the NEC Node SDK GraphQL module for querying blockchain data.


## Interfaces

### GraphqlParams Interface

**Structure:**
```typescript
interface GraphqlParams {
  url: string;
  variables: {
    address: string;
    cursor?: string | null;
    count: number;
  };
}
```

**Description:** Defines the structure for GraphQL transaction query parameters.

**Properties:**
- `url` (string): GraphQL endpoint URL
- `variables` (object): Query variables object
  - `address` (string): Account address to query
  - `cursor` (string | null, optional): Pagination cursor
  - `count` (number): Number of transactions to retrieve

### TokenParams Interface

**Structure:**
```typescript
interface TokenParams {
  url: string;
  variables: {
    address: string;
  };
}
```

**Description:** Defines the structure for GraphQL token query parameters.

**Properties:**
- `url` (string): GraphQL endpoint URL
- `variables` (object): Query variables object
  - `address` (string): Account address to query

## Transaction Functions

### getAllTransactions

**Function:** `async getAllTransactions(params: GraphqlParams): Promise<any>`

**Description:** Universal GraphQL query function using Axios for account queries. Handles normalization of balances, values, tx counts, delegations, and staker info.

**Input Parameters:**
- `params` (GraphqlParams): GraphQL query parameters object

**Response:** Promise<any> - Normalized account data with transaction list

**Error Handling:**
- Throws Error if `url` is missing or not a string
- Throws Error if `variables` is missing or not an object
- Throws Error if `variables.address` is missing or not a string
- Throws Error if `variables.cursor` is provided but not a string
- Throws Error if `variables.count` is missing or not a number
- Throws Error if GraphQL API call fails

**Data Normalization:**
The function automatically normalizes the following hex values to decimal:
- Account balance and total value (converted to Ether)
- Transaction count (converted to decimal string)
- Transaction values, gas prices (converted to Ether)
- Gas used, gas limit, nonce, index, block number, status (converted to decimal string)
- Block timestamps (converted to decimal string)
- Token transaction amounts (converted to Ether)
- Delegation amounts and rewards (converted to Ether)
- Staker information (converted to decimal strings and Ether)

**Example:**
```typescript
import { getAllTransactions } from 'necjs';

const params = {
  url: 'https://graphql.example.com',
  variables: {
    address: '0x1234567890123456789012345678901234567890',
    cursor: null,
    count: 10
  }
};

try {
  const accountData = await getAllTransactions(params);
  console.log('Account data:', accountData);
  
  // Access normalized data
  console.log('Balance:', accountData.balance, 'ETH');
  console.log('Transaction count:', accountData.txCount);
  console.log('Transactions:', accountData.txList.edges);
} catch (error) {
  console.error('Failed to fetch transactions:', error);
}
```

**Response Structure:**
```typescript
{
  address: string;
  contract?: {
    address: string;
    deployedBy: {
      hash: string;
      contractAddress: string;
    };
    name: string;
    version: string;
    compiler: string;
    sourceCode: string;
    abi: string;
    validated: boolean;
    supportContact: string;
    timestamp: string;
  };
  balance: string; // Normalized to Ether
  totalValue: string; // Normalized to Ether
  txCount: string; // Normalized to decimal string
  txList: {
    pageInfo: {
      first: string;
      last: string;
      hasNext: boolean;
      hasPrevious: boolean;
    };
    totalCount: string; // Normalized to decimal string
    edges: Array<{
      cursor: string;
      transaction: {
        hash: string;
        nonce: string; // Normalized to decimal string
        index: string; // Normalized to decimal string
        from: string;
        to: string;
        contractAddress: string;
        value: string; // Normalized to Ether
        inputData: string;
        gasUsed: string; // Normalized to decimal string
        gas: string; // Normalized to decimal string
        gasPrice: string; // Normalized to Ether
        blockHash: string;
        blockNumber: string; // Normalized to decimal string
        status: string; // Normalized to decimal string
        block: {
          number: string; // Normalized to decimal string
          timestamp: string; // Normalized to decimal string
        };
        tokenTransactions: Array<{
          hash: string;
          blockNumber: string;
          trxIndex: string;
          tokenAddress: string;
          tokenName: string;
          tokenSymbol: string;
          tokenType: string;
          tokenId: string;
          tokenDecimals: string;
          type: string;
          sender: string;
          recipient: string;
          amount: string; // Normalized to Ether
        }>;
      };
    }>;
  };
  staker?: {
    id: string;
    createdTime: string; // Normalized to decimal string
    isActive: boolean;
    totalCount?: string; // Normalized to decimal string
    totalValue?: string; // Normalized to Ether
    totalRewards?: string; // Normalized to Ether
    totalStaked?: string; // Normalized to Ether
    totalUnstaked?: string; // Normalized to Ether
  };
  delegations?: {
    totalCount: string; // Normalized to decimal string
    edges: Array<{
      delegation: {
        toStakerId: string;
        createdTime: string;
        amount: string; // Normalized to Ether
        claimedReward: string; // Normalized to Ether
        pendingRewards: Array<{
          amount: string; // Normalized to Ether
        }>;
      };
      cursor: string;
    }>;
  };
}
```

## Token Functions

### getAllTokens

**Function:** `async getAllTokens(params: TokenParams): Promise<any>`

**Description:** GraphQL query function for token summaries using Axios. Normalizes token amounts using hexToEther.

**Input Parameters:**
- `params` (TokenParams): GraphQL query parameters object

**Response:** Promise<any> - Normalized account data with token summaries

**Error Handling:**
- Throws Error if `url` is missing or not a string
- Throws Error if `variables.address` is missing or not a string
- Throws Error if GraphQL API call fails

**Data Normalization:**
The function automatically normalizes token amounts from hex to Ether using the `hexToEther` utility function.

**Example:**
```typescript
import { getAllTokens } from 'necjs';

const params = {
  url: 'https://graphql.example.com',
  variables: {
    address: '0x1234567890123456789012345678901234567890'
  }
};

try {
  const tokenData = await getAllTokens(params);
  console.log('Token data:', tokenData);
  
  // Access normalized token summaries
  if (tokenData.tokenSummaries) {
    tokenData.tokenSummaries.forEach((token: any) => {
      console.log(`${token.tokenSymbol}: ${token.amount} tokens`);
    });
  }
} catch (error) {
  console.error('Failed to fetch tokens:', error);
}
```

**Response Structure:**
```typescript
{
  tokenSummaries: Array<{
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenType: string;
    tokenDecimals: string;
    type: string;
    amount: string; // Normalized to Ether
  }>;
}
```

## Usage Examples

### Fetching Account Transactions

```typescript
import { getAllTransactions } from 'necjs';

// Basic transaction query
const transactionParams = {
  url: 'https://api.example.com/graphql',
  variables: {
    address: '0x1234567890123456789012345678901234567890',
    count: 20
  }
};

const accountData = await getAllTransactions(transactionParams);

// Access account information
console.log('Account address:', accountData.address);
console.log('Balance:', accountData.balance, 'ETH');
console.log('Total value:', accountData.totalValue, 'ETH');
console.log('Transaction count:', accountData.txCount);

// Access transaction list
if (accountData.txList && accountData.txList.edges) {
  accountData.txList.edges.forEach((edge: any) => {
    const tx = edge.transaction;
    console.log('Transaction:', {
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value + ' ETH',
      gasUsed: tx.gasUsed,
      blockNumber: tx.blockNumber
    });
  });
}
```

### Paginated Transaction Queries

```typescript
import { getAllTransactions } from 'necjs';

// First page
const firstPageParams = {
  url: 'https://api.example.com/graphql',
  variables: {
    address: '0x1234567890123456789012345678901234567890',
    count: 10
  }
};

const firstPage = await getAllTransactions(firstPageParams);

// Get cursor for next page
const nextCursor = firstPage.txList.pageInfo.last;

// Second page
const secondPageParams = {
  url: 'https://api.example.com/graphql',
  variables: {
    address: '0x1234567890123456789012345678901234567890',
    cursor: nextCursor,
    count: 10
  }
};

const secondPage = await getAllTransactions(secondPageParams);
```

### Fetching Token Information

```typescript
import { getAllTokens } from 'necjs';

// Query token summaries
const tokenParams = {
  url: 'https://api.example.com/graphql',
  variables: {
    address: '0x1234567890123456789012345678901234567890'
  }
};

const tokenData = await getAllTokens(tokenParams);

// Process token summaries
if (tokenData.tokenSummaries) {
  console.log('Token holdings:');
  tokenData.tokenSummaries.forEach((token: any) => {
    console.log(`${token.tokenName} (${token.tokenSymbol}): ${token.amount} tokens`);
    console.log(`  Type: ${token.tokenType}`);
    console.log(`  Decimals: ${token.tokenDecimals}`);
    console.log(`  Address: ${token.tokenAddress}`);
  });
}
```

### Error Handling

```typescript
import { getAllTransactions, getAllTokens } from 'necjs';

async function fetchAccountData(address: string) {
  try {
    // Fetch transactions
    const transactionData = await getAllTransactions({
      url: 'https://api.example.com/graphql',
      variables: {
        address: address,
        count: 10
      }
    });

    // Fetch tokens
    const tokenData = await getAllTokens({
      url: 'https://api.example.com/graphql',
      variables: {
        address: address
      }
    });

    return {
      transactions: transactionData,
      tokens: tokenData
    };
  } catch (error) {
    console.error('GraphQL query failed:', error.message);
    
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    
    throw error;
  }
}

// Usage
try {
  const data = await fetchAccountData('0x1234567890123456789012345678901234567890');
  console.log('Account data:', data);
} catch (error) {
  console.error('Failed to fetch account data:', error);
}
```

### Working with Contract Information

```typescript
import { getAllTransactions } from 'necjs';

const contractParams = {
  url: 'https://api.example.com/graphql',
  variables: {
    address: '0x1234567890123456789012345678901234567890',
    count: 5
  }
};

const accountData = await getAllTransactions(contractParams);

// Check if account is a contract
if (accountData.contract) {
  console.log('Contract Information:');
  console.log('  Name:', accountData.contract.name);
  console.log('  Version:', accountData.contract.version);
  console.log('  Compiler:', accountData.contract.compiler);
  console.log('  Validated:', accountData.contract.validated);
  console.log('  Deployed by:', accountData.contract.deployedBy.contractAddress);
  console.log('  Deployment hash:', accountData.contract.deployedBy.hash);
}
```

### Working with Staking Information

```typescript
import { getAllTransactions } from 'necjs';

const stakerParams = {
  url: 'https://api.example.com/graphql',
  variables: {
    address: '0x1234567890123456789012345678901234567890',
    count: 5
  }
};

const accountData = await getAllTransactions(stakerParams);

// Check staking information
if (accountData.staker) {
  console.log('Staker Information:');
  console.log('  Staker ID:', accountData.staker.id);
  console.log('  Created time:', accountData.staker.createdTime);
  console.log('  Is active:', accountData.staker.isActive);
  console.log('  Total staked:', accountData.staker.totalStaked, 'ETH');
  console.log('  Total rewards:', accountData.staker.totalRewards, 'ETH');
}

// Check delegations
if (accountData.delegations && accountData.delegations.edges) {
  console.log('Delegations:');
  accountData.delegations.edges.forEach((edge: any) => {
    const delegation = edge.delegation;
    console.log(`  To staker ${delegation.toStakerId}: ${delegation.amount} ETH`);
    console.log(`    Claimed rewards: ${delegation.claimedReward} ETH`);
    console.log(`    Pending rewards: ${delegation.pendingRewards[0]?.amount || 0} ETH`);
  });
}
``` 