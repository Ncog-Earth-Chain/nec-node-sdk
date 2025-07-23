import axios from 'axios';
import {
  hexToEther,
  hexToDecimalString
} from './utils';

export interface GraphqlParams {
  url: string;
  variables: {
    address: string;
    cursor?: string | null;
    count: number;
  };
}

/**
 * Universal GraphQL query function using Axios for account queries.
 * Handles normalization of balances, values, tx counts, delegations, and staker info.
 */
export async function getAllTransactions(params: GraphqlParams): Promise<any> {
  if (!params.url || typeof params.url !== 'string') {
    throw new Error('"url" is a required string parameter.');
  }
  if (!params.variables || typeof params.variables !== 'object') {
    throw new Error('"variables" is a required object parameter.');
  }
  if (!params.variables.address || typeof params.variables.address !== 'string') {
    throw new Error('"variables.address" is a required string parameter.');
  }
  if (params.variables.cursor && typeof params.variables.cursor !== 'string') {
    throw new Error('"variables.cursor" must be a string.');
  }
  if (!params.variables.count || typeof params.variables.count !== 'number') {
    throw new Error('"variables.count" must be a number.');
  }

  const url = params.url;
  const variables = params.variables;
  const query = `
    query AccountByAddress(
      $address: Address!
      $cursor: Cursor
      $count: Int!
    ) {
      account(address: $address) {
        address
        contract {
          address
          deployedBy {
            hash
            contractAddress
          }
          name
          version
          compiler
          sourceCode
          abi
          validated
          supportContact
          timestamp
        }
        balance
        totalValue
        txCount
        txList(cursor: $cursor, count: $count) {
          pageInfo {
            first
            last
            hasNext
            hasPrevious
          }
          totalCount
          edges {
            cursor
            transaction {
              hash
              from
              to
              value
              gasUsed
              block {
                number
                timestamp
              }
              tokenTransactions {
                trxIndex
                tokenAddress
                tokenName
                tokenSymbol
                tokenType
                tokenId
                tokenDecimals
                type
                sender
                recipient
                amount
              }
            }
          }
        }
        staker {
          id
          createdTime
          isActive
        }
        delegations {
          totalCount
          edges {
            delegation {
              toStakerId
              createdTime
              amount
              claimedReward
              pendingRewards {
                amount
              }
            }
            cursor
          }
        }
      }
    }
  `;
  try {
    const response = await axios.post(url, {
      query,
      variables
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const result = response?.data;
    const account = result?.data?.account;
    if (!account) return result;

    if (account.balance) account.balance = hexToEther(account.balance);
    if (account.totalValue) account.totalValue = hexToEther(account.totalValue);
    if (account.txCount) account.txCount = hexToDecimalString(account.txCount);
    if (account.txList) {
      if (account.txList.totalCount) account.txList.totalCount = hexToDecimalString(account.txList.totalCount);
      if (Array.isArray(account.txList.edges)) {
        account.txList.edges.forEach((edge: any) => {
          if (!edge?.transaction) return;
          if (edge.transaction.value) edge.transaction.value = hexToEther(edge.transaction.value);
          if (edge.transaction.gasUsed) edge.transaction.gasUsed = hexToDecimalString(edge.transaction.gasUsed);
          if (edge.transaction.block) {
            if (edge.transaction.block.number) edge.transaction.block.number = hexToDecimalString(edge.transaction.block.number);
            if (edge.transaction.block.timestamp) edge.transaction.block.timestamp = hexToDecimalString(edge.transaction.block.timestamp);
          }
          if (Array.isArray(edge.transaction.tokenTransactions)) {
            edge.transaction.tokenTransactions.forEach((tokenTransaction: any) => {
              if (tokenTransaction?.amount) tokenTransaction.amount = hexToEther(tokenTransaction.amount);
            });
          }
        });
      }
    }
    if (account.delegations) {
      if (account.delegations.totalCount) account.delegations.totalCount = hexToDecimalString(account.delegations.totalCount);
      if (Array.isArray(account.delegations.edges)) {
        account.delegations.edges.forEach((edge: any) => {
          if (!edge?.delegation) return;
          if (edge.delegation.amount) edge.delegation.amount = hexToEther(edge.delegation.amount);
          if (edge.delegation.claimedReward) edge.delegation.claimedReward = hexToEther(edge.delegation.claimedReward);
          if (Array.isArray(edge.delegation.pendingRewards)) {
            edge.delegation.pendingRewards.forEach((pendingReward: any) => {
              if (pendingReward?.amount) pendingReward.amount = hexToEther(pendingReward.amount);
            });
          }
        });
      }
    }
    if (account.staker) {
      if (account.staker.createdTime) account.staker.createdTime = hexToDecimalString(account.staker.createdTime);
      if (account.staker.totalCount) account.staker.totalCount = hexToDecimalString(account.staker.totalCount);
      if (account.staker.totalValue) account.staker.totalValue = hexToEther(account.staker.totalValue);
      if (account.staker.totalRewards) account.staker.totalRewards = hexToEther(account.staker.totalRewards);
      if (account.staker.totalStaked) account.staker.totalStaked = hexToEther(account.staker.totalStaked);
      if (account.staker.totalUnstaked) account.staker.totalUnstaked = hexToEther(account.staker.totalUnstaked);
    }
    return account;
  } catch (error: any) {
    console.error('GraphQL API call failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

/**
 * GraphQL query function for token summaries using Axios.
 * Normalizes token amounts using hexToEther.
 */

export interface TokenParams {
  url: string;
  variables: {
    address: string;
  };
}

export async function getAllTokens(params: TokenParams): Promise<any> {
  if (!params.url || typeof params.url !== 'string') {
    throw new Error('"url" is a required string parameter.');
  }
  if (!params.variables || typeof params.variables.address !== 'string') {
    throw new Error('"variables.address" is a required string parameter.');
  }
  const url = params.url;
  const variables = { address: params.variables.address };
  const query = `
    query ($address: Address!) {
      account(address: $address) {
        tokenSummaries {
          tokenAddress
          tokenName
          tokenSymbol
          tokenType
          tokenDecimals
          type
          amount
        }
      }
    }
  `;
  try {
    const response = await axios.post(url, {
      query,
      variables
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    const result = response?.data;
    const account = result?.data?.account;
    if (!account) return result;
    if (account.tokenSummaries) {
      account.tokenSummaries.forEach((tokenSummary: any) => {
        if (tokenSummary.amount) tokenSummary.amount = hexToEther(tokenSummary.amount);
      });
    }
    return account;
  } catch (error: any) {
    console.error('Token API call failed:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
} 