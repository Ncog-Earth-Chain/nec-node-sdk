// React Native-specific entry point - no Node.js imports.
//
// KEM capability note: this entry deliberately does NOT export `loadWasm` / the `MlKem` interface. ML-KEM-1024
// is provided by a Go WebAssembly module that the Node and browser entries load, but React Native's JS engine
// (Hermes/JSC) has no WASM loader, so the KEM is unavailable here. RN apps that need ML-KEM encryption should
// bind a native ML-KEM module. Everything else — transactions (the WASM-free ML-DSA-87 tx-signer), DDB, and
// personal-message signing — is fully available on RN.
export {
  Provider, RpcError,
  type Block, type TransactionResponse, type TransactionReceipt, type Log, type LogFilter,
  type ProviderRequestMiddleware, type ProviderResponseMiddleware,
} from './provider';
export {
  Ddb, canonicalDdbOperationHash, canonicalDdbRequestId,
  buildDdbOp, privateKeyDdbSigner,
  type DdbSigner, type DdbSignerLike, type DdbPreparedOp, type DdbSignedOpEnvelope,
  type DdbFilter, type DdbFilterOp, type DdbQueryOptions, type DdbSignOptions,
  type DdbRow, type DdbSchemaInfo, type DdbEndorsementStatus, type DdbConsensusStats,
  type DdbValidatorSet, type DdbStorageStats,
} from './ddb';
export {
  type ContractDefinition, type DdbSchemaDef, type DdbTableDef, type DdbColumnDef, type DdbIndexDef,
  type DdbProcedureDef, type DdbParameterDef, type DdbPointWrite, type DdbPKBinding, type DdbGasPolicy,
  isRowLockEligible, validateContractDefinition, validatePointWrite, tablePKColumns, isMutatingBody, maskSQLLiterals,
} from './ddb-schema';
// The native tx-signer is WASM-free and RN-safe — RN apps sign upgraded-format txs through it.
export { Wallet, Signer, type TxParams } from './wallet';
export {
  signTransactionMLDSA87, privateKeyToAddress, publicKeyToAddress, decodeRLPTransaction,
  type SignedTx, type SignOptions,
} from './tx-signer';
export { Contract, EventStream, type ISigner } from './contract';
export { ContractFactory } from './contract-factory';
export { Subscription } from './subscription';
export { hexToDecimalString, decimalToHex, parseUnits, etherToWeiHex, hexToEther, formatUnits, hexToNec, necToHex, weiToNec, serializeForRpc, normalizeResponse, isValidAddress, decimalToWei, kyberPrivateKeyToEncryptedPublicKeyAddress, generateMLDSAKeyPair, mldsaPublicKeyToAddress, mldsaPrivateKeyToPublicKey, signPersonalMessageMLDSA, verifyPersonalMessageMLDSA, personalTextHash } from './utils';
export { getAllTransactions, getAllTokens } from './graphql';