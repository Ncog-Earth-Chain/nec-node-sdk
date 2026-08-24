# NestJS Integration

Integrate the NECJS SDK in a NestJS service for blockchain operations. Example:

```ts
// src/ncog/ncog.service.ts
import { Injectable } from '@nestjs/common';
import { loadWasm, Provider, Wallet } from '@ncog/necjs';

@Injectable()
export class NcogService {
  private provider: Provider;
  private wallet: Wallet;

  constructor() {
    this.init();
  }

  async init() {
    await loadWasm();
    this.wallet = await Wallet.create('your-private-key-hex');
    this.provider = new Provider('https://rpc.ncog.earth');
  }

  async getBalance(): Promise<number> {
    // Provider.getBalance returns the balance in NEC as a number (converted from wei).
    return this.provider.getBalance(this.wallet.address);
  }
}
```

Then inject and use `NcogService` in your controllers or other services as needed. 

---

## Contract Deployment Example

```ts
import { Injectable } from '@nestjs/common';
import { loadWasm, Provider, Wallet, ContractFactory } from '@ncog/necjs';

@Injectable()
export class ContractService {
  private provider: Provider;
  private signer: any;

  constructor() {
    this.init();
  }

  async init() {
    await loadWasm();
    const wallet = await Wallet.create('your-private-key-hex');
    this.provider = new Provider('https://rpc.ncog.earth');
    this.signer = wallet.connect(this.provider);
  }

  async deployContract(abi: any[], bytecode: string, args: any[] = []) {
    const factory = new ContractFactory(abi, bytecode, this.provider, this.signer);
    const contract = await factory.deploy(args);
    return contract.address;
  }
}
```

---

## Real-Time Event Subscription Example

```ts
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Subscription } from '@ncog/necjs';

@Injectable()
export class EventService implements OnModuleDestroy {
  private sub: Subscription;

  constructor() {
    this.sub = new Subscription('wss://rpc.ncog.earth');
    this.init();
  }

  async init() {
    await this.sub.connect();
    this.sub.on('open', () => console.log('WebSocket connected!'));
    this.sub.on('close', () => console.log('WebSocket disconnected!'));
    this.sub.on('error', (err) => console.error('WebSocket error:', err));
    await this.sub.subscribe('newHeads', [], (blockHeader) => {
      console.log('New block header:', blockHeader);
    });
  }

  onModuleDestroy() {
    this.sub.disconnect();
  }
}
```

---

## DDB (Decentralized Database) Example

The `Ddb` client wraps the node's `ddb_*` RPC namespace. Writes are **client-signed** with the
caller's ML-DSA-87 key (the `*Signed` methods) and return an endorsement `requestId`; reads
(`getSchema` / `select` / `query`) hit the node's Postgres directly and need no consensus.

```ts
import { Injectable } from '@nestjs/common';
import { loadWasm, Provider, Wallet, Ddb, ContractDefinition } from '@ncog/necjs';

@Injectable()
export class DdbService {
  private provider: Provider;
  private ddb: Ddb;
  private privateKey: string;

  async init() {
    await loadWasm();
    this.provider = new Provider('https://rpc.ncog.earth');
    this.ddb = new Ddb(this.provider);
    const wallet = await Wallet.create('your-private-key-hex');
    this.privateKey = wallet.privateKey;
  }

  // WRITE: create a contract schema (client-signed). Returns the endorsement requestId.
  async createUsersSchema(): Promise<string> {
    const definition: ContractDefinition = {
      contract_name: 'users',
      schema: {
        tables: [
          {
            name: 'accounts',
            columns: [
              { name: 'username', type: 'text', constraints: ['primary key'] },
              { name: 'age', type: 'int' },
            ],
          },
        ],
      },
    };
    const requestId = await this.ddb.createSchemaSigned(this.privateKey, 'users', definition);
    await this.ddb.waitForEndorsement(requestId); // wait until committed
    return requestId;
  }

  // READ: derive the db_name, then select rows (no consensus).
  async listAccounts(contractAddress: string) {
    const dbName = Ddb.deriveDbName(contractAddress);
    return this.ddb.select(dbName, 'accounts', { limit: 50 });
  }
}
``` 