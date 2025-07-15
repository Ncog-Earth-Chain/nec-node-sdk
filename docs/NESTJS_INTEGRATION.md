# NestJS Integration

Integrate the NCOG SDK in a NestJS service for blockchain operations. Example:

```ts
// src/ncog/ncog.service.ts
import { Injectable } from '@nestjs/common';
import { loadWasm, Provider, Wallet } from 'ncog';

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

  async getBalance(): Promise<string> {
    return this.provider.getBalance(this.wallet.address);
  }
}
```

Then inject and use `NcogService` in your controllers or other services as needed. 

---

## Contract Deployment Example

```ts
import { Injectable } from '@nestjs/common';
import { loadWasm, Provider, Wallet, ContractFactory } from 'ncog';

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
import { Subscription } from 'ncog';

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