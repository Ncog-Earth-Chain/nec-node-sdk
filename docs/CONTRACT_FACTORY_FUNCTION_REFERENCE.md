# Contract Factory Function Reference

This document provides detailed information about all functions available in the NEC Node SDK ContractFactory module for smart contract deployment and management.

## ContractFactory Class

### Constructor

**Function:** `constructor(abi: any[], bytecode: string, provider: Provider, signer?: ISigner)`

**Description:** Creates a new ContractFactory instance for deploying and managing smart contracts.

**Input Parameters:**
- `abi` (any[]): Contract ABI (Application Binary Interface)
- `bytecode` (string): Contract bytecode (compiled contract)
- `provider` (Provider): Provider instance for blockchain interaction
- `signer` (ISigner, optional): Signer for transaction signing

**Response:** Creates a new ContractFactory instance

**Example:**
```typescript
const factory = new ContractFactory(contractABI, contractBytecode, provider, signer);
```

### Properties

- `abi` (any[]): Contract ABI (readonly)
- `bytecode` (string): Contract bytecode (readonly)
- `provider` (Provider): Provider instance (readonly)
- `signer` (ISigner, optional): Signer instance (readonly)

### Methods

#### deploy

**Function:** `async deploy(constructorArgs: any[] = [], options: Record<string, any> = {}): Promise<Contract>`

**Description:** Deploys a new contract instance to the blockchain with automatic gas estimation and transaction parameter optimization.

**Input Parameters:**
- `constructorArgs` (any[], optional): Constructor arguments for the contract (defaults to empty array)
- `options` (Record<string, any>, optional): Deployment options including gas, gasPrice, nonce, etc. (defaults to empty object)

**Response:** Promise<Contract> - Deployed contract instance

**Error Handling:**
- Throws Error if no deployer (signer or from address) is specified
- Throws Error if gas estimation fails (falls back to default 7,000,000 gas)

**Features:**
- **Automatic Gas Estimation**: Estimates gas with 20% buffer if not provided
- **Automatic Nonce Management**: Fetches current nonce if not provided
- **Automatic Gas Price**: Fetches current gas price if not provided
- **Constructor Support**: Handles constructor arguments encoding
- **Fallback Gas Limit**: Uses 7,000,000 gas as fallback if estimation fails

**Example:**
```typescript
// Deploy with constructor arguments
const contract = await factory.deploy(['Initial Value', 100], {
  gasPrice: '0x09184e72a000',
  gasLimit: '0x186a0'
});

console.log('Contract deployed at:', contract.address);

// Deploy without constructor arguments
const simpleContract = await factory.deploy();

// Deploy with custom options
const customContract = await factory.deploy([], {
  from: '0x1234567890123456789012345678901234567890',
  gasPrice: '0x09184e72a000',
  nonce: 5
});
```

## Usage Examples

### Basic Contract Factory Setup

```typescript
import { Provider, ContractFactory, Wallet } from '@ncog/necjs';

// Create provider and signer
const provider = new Provider('https://mainnet.infura.io/v3/YOUR_PROJECT_ID');
const wallet = await Wallet.create('0x1234567890123456789012345678901234567890123456789012345678901234');
const signer = wallet.connect(provider);

// Create contract factory
const factory = new ContractFactory(contractABI, contractBytecode, provider, signer);

console.log('Factory created with ABI length:', factory.abi.length);
console.log('Bytecode length:', factory.bytecode.length);
```

### Contract Deployment

```typescript
// Deploy a simple contract
const simpleContract = await factory.deploy();
console.log('Simple contract deployed at:', simpleContract.address);

// Deploy with constructor arguments
const tokenContract = await factory.deploy([
  'My Token',           // name
  'MTK',               // symbol
  18,                  // decimals
  '1000000000000000000000000' // total supply
], {
  gasPrice: '0x09184e72a000'
});

console.log('Token contract deployed at:', tokenContract.address);

// Deploy with custom options
const customContract = await factory.deploy(['Custom Value'], {
  gasPrice: '0x09184e72a000',
  gasLimit: '0x186a0',
  nonce: 10
});
```

### Advanced Deployment with Error Handling

```typescript
async function deployContractSafely(factory: ContractFactory, constructorArgs: any[] = []) {
  try {
    console.log('Starting contract deployment...');
    
    // Deploy with automatic gas estimation
    const contract = await factory.deploy(constructorArgs, {
      gasPrice: '0x09184e72a000'
    });
    
    console.log('Contract deployed successfully at:', contract.address);
    return contract;
    
  } catch (error) {
    console.error('Deployment failed:', error.message);
    
    if (error.message.includes('No deployer')) {
      console.error('Please provide a signer or from address');
    } else if (error.message.includes('gas')) {
      console.error('Gas estimation failed, using fallback gas limit');
    }
    
    throw error;
  }
}

// Usage
const contract = await deployContractSafely(factory, ['Initial Value']);
```

### Factory with Different Signer Types

```typescript
import { ContractFactory, ExtensionSigner } from '@ncog/necjs';

// With wallet signer
const walletFactory = new ContractFactory(abi, bytecode, provider, walletSigner);

// With extension signer
const extensionFactory = new ContractFactory(abi, bytecode, provider, extensionSigner);

// Without signer (requires 'from' in options)
const noSignerFactory = new ContractFactory(abi, bytecode, provider);

// Deploy with no signer (requires from address)
const contract = await noSignerFactory.deploy([], {
  from: '0x1234567890123456789012345678901234567890'
});
```

### Batch Contract Deployment

```typescript
async function deployMultipleContracts(factories: ContractFactory[], constructorArgs: any[][] = []) {
  const deployedContracts = [];
  
  for (let i = 0; i < factories.length; i++) {
    const factory = factories[i];
    const args = constructorArgs[i] || [];
    
    console.log(`Deploying contract ${i + 1}/${factories.length}...`);
    
    const contract = await factory.deploy(args, {
      gasPrice: '0x09184e72a000'
    });
    
    deployedContracts.push({
      index: i,
      address: contract.address,
      contract: contract
    });
    
    console.log(`Contract ${i + 1} deployed at:`, contract.address);
  }
  
  return deployedContracts;
}

// Usage
const factories = [
  new ContractFactory(abi1, bytecode1, provider, signer),
  new ContractFactory(abi2, bytecode2, provider, signer),
  new ContractFactory(abi3, bytecode3, provider, signer)
];

const constructorArgs = [
  ['Token1', 'TK1'],
  ['Token2', 'TK2'],
  ['Token3', 'TK3']
];

const deployed = await deployMultipleContracts(factories, constructorArgs);
console.log('All contracts deployed:', deployed.map(c => c.address));
```

### Contract Factory with Custom Options

```typescript
// Create factory with specific configuration
const factory = new ContractFactory(abi, bytecode, provider, signer);

// Deploy with comprehensive options
const contract = await factory.deploy(['Initial Value'], {
  gasPrice: '0x09184e72a000',
  gasLimit: '0x186a0',
  nonce: 5,
  from: '0x1234567890123456789012345678901234567890',
  value: '0x0'
});

// Interact with all contracts
for (const contract of contracts) {
  const balance = await contract.call('balanceOf', ['0x1234567890123456789012345678901234567890']);
  console.log(`Balance in ${contract.address}:`, balance);
}
``` 