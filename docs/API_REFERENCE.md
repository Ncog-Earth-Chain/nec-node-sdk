# API Reference

This document provides an overview of the main modules, classes, and features of the NECJS SDK. For full source code and the latest updates, see:

[https://github.com/Ncog-Earth-Chain/nec-node-sdk](https://github.com/Ncog-Earth-Chain/nec-node-sdk)

---

## Modules & Classes

### Provider
- Low-level JSON-RPC client for NCOG/Ethereum-compatible nodes. Constructor: `new Provider(url)`.
- Methods: `getBalance`, `getGasPrice`, `getTransactionCount`, `getChainId`, `sendRawTransaction`, `callRpc`, `send`, etc.
- Typed getters return `Block`, `TransactionResponse`, `TransactionReceipt`, and `Log` shapes; log filters via `newFilter` / `getFilterChanges` / `getFilterLogs` / `watchLogs`.

### Wallet & Signer
- Wallet: Private-key management and address derivation (address = `keccak256(rawMLDSApubkey)[12:]`). Transactions are signed with **ML-DSA-87** (SigVersion-v2, mandatory `chainId`).
- Signer: Sends and decodes transactions.
- Methods: `Wallet.create(privateKey)`, `Wallet.connect(privateKey, providerUrl?)` (static, returns `{ signer, provider, address }`), `wallet.connect(provider)` (instance, returns a `Signer`), `Signer.sendTransaction(txParams)`, `Signer.decode(rawSigned)`.
- Note: there is **no** `Wallet.fromMnemonic`.

### ExtensionSigner
- Integrates with browser extension wallets (e.g., `window.ncogWallet`). Constructor: `new ExtensionSigner(injectedProvider, provider)`.
- Methods: `getAddress`, `sendTransaction(tx)`, `on(event, listener)`.

### Contract
- Interact with smart contracts (web3.js-style dynamic methods). Constructor: `new Contract(address, abi, provider, signer?)`.
- Methods: `call`, `send`, `estimateGas`, `methods.myMethod(...args).call()/.send(opts)`.
- Static deploy: `Contract.deploy({ abi, bytecode, provider, deployer, constructorArgs?, options? })` → `{ contractAddress, txHash, receipt }`.

### ContractFactory
- Deploy new contracts and attach to existing ones. Constructor: `new ContractFactory(abi, bytecode, provider, signer?)`.
- Methods: `deploy(constructorArgs?, options?)` → returns a `Contract` instance; `attach(address)` → returns a `Contract` instance.
- Handles gas estimation and constructor arguments.

### Subscription (Event)
- WebSocket-based real-time event subscriptions (Node.js, browser, React Native). Constructor: `new Subscription(wsUrl)` (a WebSocket URL string — **not** a `Provider`).
- Methods: `connect()`, `subscribe(subType, params, handler)` (params is an array; resolves to a subscription id), `unsubscribe(id)`, `on(event, handler)`, `off(event, handler)`, `sendRpc(method, params)`, `disconnect()`.
- Supports Ethereum-compatible event types (e.g., `newHeads`, `logs`). You must `await connect()` before `subscribe`.

### MLKEM (Post-Quantum Cryptography)
- **KEM-only** (ML-KEM-1024 key exchange + symmetric AEAD). `loadWasm()` resolves to an `MlKem` **instance**; call these methods on it — they are **not** static.
- Methods: `keyGen()` → `{ pubKey, privKey }`, `encrypt(pubKey, message)` → `{ encryptedData, version }`, `decrypt(privKey, encryptedData, version)`, `symEncrypt(ssKey, message)`, `symDecrypt(ssKey, encryptedData, version)`.
- There are **no** signing/verify or address-derivation methods on `MlKem`. Transaction signing is a separate scheme — see **Tx-Signer (v2)** below.

### Tx-Signer (v2)
- WASM-free **ML-DSA-87** transaction signer in the SigVersion-v2 wire format (byte-compatible with the node). `chainId` is mandatory and bound into the signing digest for replay protection.
- Functions: `signTransactionMLDSA87(txParams, privateKeyHex, options?)` → `SignedTx` (`{ raw, rawTransaction, hash, publicKey, signature }`); `privateKeyToAddress(privateKeyHex)`; `publicKeyToAddress(publicKey)`; `decodeRLPTransaction(rawHex)`.
- Types: `SignedTx`, `SignOptions` (`{ publicKeyHex? }`).

### DDB (Decentralized Database)
- Client for NCOG's on-chain relational database (`ddb_*` RPC namespace). Constructor: `new Ddb(provider)`. See the full [DDB Function Reference](DDB_FUNCTION_REFERENCE.md).
- **Signed writes** (caller signs client-side with their ML-DSA-87 key; each returns an endorsement `requestId`): `createSchemaSigned(privateKey, schemaName, definition, opts?)`, `callProcedureSigned(privateKey, schemaName, procedure, args?, opts?)`, `grantRoleSigned(privateKey, schemaName, role, account, opts?)`, `revokeRoleSigned(privateKey, schemaName, role, account, opts?)`.
- **Track a write**: `waitForEndorsement(requestId, opts?)`, `getEndorsementStatus(requestId)`.
- **Reads** (this node's Postgres; no consensus): `getSchema(contractAddress)` — takes the ADDRESS, not the derived name — plus `select(dbName, tableName, opts?)` and `query(dbName, tableName, limit?)`, which take `Ddb.deriveDbName(address)`.
- **Status / introspection**: `getValidators()`, `getConsensusStats()`, `getStats()`, `getStateAcc(schemaName)`, `shadowStatus()`.
- **Helper**: static `Ddb.deriveDbName(contractAddress)` — the derived `db_name` every schema-scoped method (except `createSchema*`) expects.
- Deprecated server-signed variants (`createSchema` / `callProcedure` / `grantRole` / `revokeRole`) exist but require the node to run with `NEC_DDB_ALLOW_LOCAL_SIGN=1` and fail closed on a production node.
- Also exported: `canonicalDdbOperationHash`, `canonicalDdbRequestId` (advanced manual signing), and the DDB types (`DdbFilter`, `DdbQueryOptions`, `DdbRow`, `DdbSchemaInfo`, `DdbEndorsementStatus`, `DdbConsensusStats`, `DdbValidatorSet`, `DdbStorageStats`, etc.).

### Utilities
- Hex/decimal conversion, NEC/Wei conversion, address validation, JSON-RPC normalization.
- Methods: `hexToDecimalString`, `decimalToHex`, `parseUnits`, `etherToWeiHex`, `hexToEther`, `formatUnits`, `hexToNec`, `necToHex`, `weiToNec`, `decimalToWei`, `isValidAddress`, `serializeForRpc`, `normalizeResponse`.
- ML-DSA helpers: `generateMLDSAKeyPair`, `mldsaPublicKeyToAddress`, `mldsaPrivateKeyToPublicKey`, `signPersonalMessageMLDSA`, `verifyPersonalMessageMLDSA`, `personalTextHash`.

---

## Usage References

- **Framework Integration & Examples:**
  - [Framework Integration](FRAMEWORK_INTEGRATION.md)
  - [Node.js Integration](NODEJS_INTEGRATION.md)
  - [NestJS Integration](NESTJS_INTEGRATION.md)
  - [Extension Wallet Integration](EXTENSION_WALLET.md)

- **Entry Point:**
  - [src/index.ts](../src/index.ts)

- **For full API and advanced usage, see the GitHub repository.** 