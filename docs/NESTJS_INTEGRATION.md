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