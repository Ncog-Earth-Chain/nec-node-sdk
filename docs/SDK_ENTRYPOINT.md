# SDK Entry Point

The main entry point for the SDK is:

[src/index.ts](../src/index.ts)

```ts
import { Provider, Wallet, Ddb /* ... */ } from '@ncog/necjs';
```

---

## Main Exports

Regenerated from the current `src/index.ts` export list.

### Provider (`./provider`)
- **Provider** — JSON-RPC client for NCOG chain nodes.
- **RpcError** — structured JSON-RPC error.
- Types: **Block**, **TransactionResponse**, **TransactionReceipt**, **Log**, **LogFilter**,
  **ProviderRequestMiddleware**, **ProviderResponseMiddleware**.

### DDB client (`./ddb`)
- **Ddb** — client for the decentralized on-chain database (`ddb_*` RPC namespace).
- **canonicalDdbOperationHash**, **canonicalDdbRequestId** — canonical hashing helpers for
  client-signed DDB operations.
- Types: **DdbFilter**, **DdbFilterOp**, **DdbQueryOptions**, **DdbSignOptions**, **DdbRow**,
  **DdbSchemaInfo**, **DdbEndorsementStatus**, **DdbConsensusStats**, **DdbValidatorSet**,
  **DdbStorageStats**.

### DDB contract definitions (`./ddb-schema`)
- **isRowLockEligible**, **validateContractDefinition**, **validatePointWrite**, **tablePKColumns**,
  **isMutatingBody**, **maskSQLLiterals** — build-time contract-definition validation helpers.
- Types: **ContractDefinition**, **DdbSchemaDef**, **DdbTableDef**, **DdbColumnDef**, **DdbIndexDef**,
  **DdbProcedureDef**, **DdbParameterDef**, **DdbPointWrite**, **DdbPKBinding**, **DdbGasPolicy**.

### Wallet (`./wallet`)
- **Wallet**, **Signer** — local ML-DSA-87 wallet + transaction signer.
- Type: **TxParams**.

### Transaction signer (`./tx-signer`)
- **signTransactionMLDSA87**, **privateKeyToAddress**, **publicKeyToAddress**, **decodeRLPTransaction**
  — SigVersion-v2 ML-DSA-87 signing (chainId is always bound; no wire-format toggles).
- Types: **SignedTx**, **SignOptions**.

### Contracts (`./contract`, `./contract-factory`)
- **Contract**, **EventStream** — smart-contract interaction (web3.js-style `methods` / `events`).
- **ContractFactory** — deploy and attach to contracts.
- Type: **ISigner**.

### Browser extension (`./extension`)
- **ExtensionSigner** — signer backed by an injected browser wallet.
- Type: **InjectedProvider**.

### WebSocket subscriptions (`./subscription`)
- **Subscription** — WebSocket-based real-time event subscriptions.

### Post-quantum KEM (`./webassembly/mlkem`)
- **loadWasm**, **loadWasmFromBuffer** — load the ML-KEM (Kyber) WebAssembly module.
- Type: **MlKem** — KEM-only encryption interface (not transaction signing).

### Utilities (`./utils`)
- Unit converters: **hexToDecimalString**, **decimalToHex**, **parseUnits**, **formatUnits**,
  **decimalToWei**, **etherToWeiHex**, **hexToEther**, **hexToNec**, **necToHex**, **weiToNec**.
- RPC serialization: **serializeForRpc**, **normalizeResponse**.
- Validation: **isValidAddress**.
- Cryptography: **generateMLDSAKeyPair**, **mldsaPublicKeyToAddress**, **mldsaPrivateKeyToPublicKey**,
  **signPersonalMessageMLDSA**, **verifyPersonalMessageMLDSA**, **personalTextHash**,
  **kyberPrivateKeyToEncryptedPublicKeyAddress**.

### GraphQL (`./graphql`)
- **getAllTransactions**, **getAllTokens** — explorer GraphQL account/token queries.

See the [API Reference](API_REFERENCE.md) and the per-module `*_FUNCTION_REFERENCE.md` files for
details on each module.
