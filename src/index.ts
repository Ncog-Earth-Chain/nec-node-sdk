export {
  Provider, RpcError,
  type Block, type TransactionResponse, type TransactionReceipt, type Log, type LogFilter,
  type ProviderRequestMiddleware, type ProviderResponseMiddleware,
} from './provider';
export {
  Ddb, canonicalDdbOperationHash, canonicalDdbRequestId,
  buildDdbOp, privateKeyDdbSigner,
  // Operation preimage v2 (SEC-03): opt in per call or per Ddb once the network activates it.
  canonicalDdbOperationBytesV2, canonicalDdbOperationHashV2, canonicalDdbRequestIdV2, ddbOpPreimageDbIdentity,
  type DdbCanonicalOpV2, type DdbOpPreimageVersion, type DdbOpPreimageMode, DDB_OP_PREIMAGE_V2_FEATURE, type DdbOptions,
  buildDdbSignedRead, canonicalDdbSignedReadBytes, canonicalDdbSignedReadHash,
  type DdbSignedReadEnvelope, type DdbSignedReadOptions, type DdbPreparedRead,
  buildDdbSignedReadProcedure, canonicalDdbSignedReadProcedureBytes, canonicalDdbSignedReadProcedureHash,
  type DdbSignedReadProcedureEnvelope, type DdbSignedReadProcedureOptions, type DdbPreparedReadProcedure,
  type DdbSigner, type DdbSignerLike, type DdbPreparedOp, type DdbSignedOpEnvelope,
  // A submit hands back BOTH handles: the endorsement requestId and the node's commit tx hash. The
  // second is the only input ddb_getCommitStatus accepts, and that RPC is the only one that can report
  // a deterministic skip -- see DdbSubmitReceipt.
  type DdbSubmitReceipt, type DdbCommitStatus,
  type DdbFilter, type DdbFilterOp, type DdbQueryOptions, type DdbSignOptions,
  type DdbRow, type DdbSchemaInfo, type DdbEndorsementStatus, type DdbConsensusStats,
  type DdbValidatorSet, type DdbStorageStats,
  // DB-02 (NEC-78), owner ruling 17: opt-in exact int8 reads (bigint), see DdbReadFormat.
  ddbExactRows, DDB_EXACT_NUMBERS_UNSUPPORTED, type DdbReadFormat, type DdbExactRow, type DdbReadColumn, type DdbExactVersionedRows,
  // DB-01 transactions (NEC-77): one caller's atomic batch on one database, with a read set.
  buildDdbTransaction, canonicalDdbTxnId, canonicalDdbTxnMemberHash, isRetryableDdbTxnSkip,
  DDB_TXN_MAX_OPS, DDB_TXN_MAX_READS,
  type DdbTxnRead, type DdbTxnMemberSpec, type DdbTxnOptions, type DdbPreparedTxn, type DdbPreparedTxnMember,
  type DdbTxnHeaderEnvelope, type DdbTxnReceipt,
  // DB-02 (NEC-78) C-10: bytea arguments in and bytea row values out, byte for byte.
  ddbByteaArg, ddbByteaFromRow,
} from './ddb';
// Typed DDB contract definitions + the point-op (row-lock) declaration, and build-time eligibility validation.
export {
  type ContractDefinition, type DdbSchemaDef, type DdbTableDef, type DdbColumnDef, type DdbIndexDef,
  type DdbProcedureDef, type DdbParameterDef, type DdbPointWrite, type DdbPKBinding, type DdbGasPolicy,
  isRowLockEligible, validateContractDefinition, validatePointWrite, tablePKColumns, isMutatingBody, maskSQLLiterals,
} from './ddb-schema';
export { Wallet, Signer, type TxParams } from './wallet';
// Transaction signer (SigVersion-v2 ML-DSA-87; chainId is always bound — no wire-format toggles).
export {
  signTransactionMLDSA87, signRotatedTransactionMLDSA87, privateKeyToAddress, publicKeyToAddress, decodeRLPTransaction,
  SIGVER_MLDSA_V2, SIGVER_ROTATED,
  type SignedTx, type SignOptions,
} from './tx-signer';
// Account key rotation (Model B: the KEY changes, the ADDRESS does not) + guardian social recovery.
// See the header of src/key-registry.ts for the end-to-end rotation and recovery flows.
export {
  KEY_REGISTRY_ADDRESS, KEY_REGISTRY_SELECTORS, REG_OFF,
  MLDSA87_PUBKEY_BYTES, MLDSA87_SIG_BYTES,
  MIN_ROTATION_GAP, RECOVERY_DELAY_BLOCKS, RECOVERY_COOLDOWN_BLOCKS, MAX_GUARDIANS, MLDSA_VERIFY_GAS,
  recordBaseSlot, registrySlot, guardianSlot,
  rotationSigningHash, recoverySigningHash, keyHashOf,
  signRotationProof, signRecoveryProof, signGuardianApproval,
  encodeRotateKey, encodeSetGuardians, encodeInitiateRecovery, encodeFinalizeRecovery, encodeCancelRecovery,
  keyRegistryGas, readKeyRegistry, senderFieldsFor,
  // The recovery/rotation timing constants are BLOCK counts. These measure the chain's actual block
  // rate so a wallet never has to convert them with a hardcoded (and, on the deployed net, wildly
  // wrong) seconds-per-block assumption.
  sampleBlockRate, estimateRecoveryWindow,
  type RotationBinding, type KeyProof, type GuardianApproval, type KeyRegistryRecord,
  type StorageReader, type KeyRegistryOp, type BlockRateReader, type BlockRateSample,
  type RecoveryWindowEstimate,
} from './key-registry';
export { Contract, EventStream, type ISigner } from './contract';
export { type InjectedProvider, ExtensionSigner } from './extension';
export { Subscription } from './subscription';
export { ContractFactory } from './contract-factory';
export { loadWasm, loadWasmFromBuffer, type MlKem } from './webassembly/mlkem';
export { hexToDecimalString, decimalToHex, parseUnits, etherToWeiHex, hexToEther, formatUnits, hexToNec, necToHex, weiToNec, serializeForRpc, normalizeResponse, isValidAddress, decimalToWei, kyberPrivateKeyToEncryptedPublicKeyAddress, generateMLDSAKeyPair, mldsaPublicKeyToAddress, mldsaPrivateKeyToPublicKey, signPersonalMessageMLDSA, verifyPersonalMessageMLDSA, personalTextHash } from './utils';
export { getAllTransactions, getAllTokens } from './graphql';
// PRIV-02 (NEC-84): client-side envelope for CONFIDENTIAL columns + recipient-key directory digests.
export * as confidential from './confidential';
