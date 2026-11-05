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
  type DdbFilter, type DdbFilterOp, type DdbQueryOptions, type DdbSignOptions, type DdbUpdateSchemaOptions,
  type DdbRow, type DdbSchemaInfo, type DdbEndorsementStatus, type DdbConsensusStats,
  type DdbContractAlias, type DdbContractAliasList,
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
  // DB-02i (NEC-189): the supersedes list of a retyping upgrade (under ddb-signature-supersede).
  type DdbSupersededSignature, type DdbSupersedesOptions, deriveSupersedes, validateSupersedes, withSupersedes,
} from './ddb-schema';
// DB-08 (NEC-83): verify a durable-to-group receipt against the epoch committee (approve quorum by weight).
export {
  verifyGroupDurableReceipt, groupDurableDigest, decodeGroupDurableReceiptRlp, ddbCommitteeFromRpc, GROUP_DURABLE_DOMAIN,
  type GroupDurableReceipt, type GroupDurableSignature, type DdbCommittee, type DdbCommitteeMember,
  type GroupDurableVerifyOptions, type GroupDurableVerdict,
} from './ddb-group-durable';
// PLACE-02 (NEC-93): provider discovery client (per-epoch cache, record proofs, two-node cross-check) and
// wallet-signed capability tokens.
export {
  DdbResolver, type DdbResolverOptions, type ResolveResult, type ResolvedDatabase, type HostEndpointsJSON, type HostMemberJSON,
} from './ddb-resolve';
export {
  ddbSignedReadHome, type DdbCurrentReadRoute, type DdbCurrentReadMember, type DdbPrivateReadOptions,
  type DdbPrivateReadPolicy, type DdbPrivateReadConnection, type DdbPrivateReadEndpoint, type DdbAuthenticatedReadTransport,
} from './ddb-private-read';
// Actual Node TLS transport; deliberately absent from browser and React Native entry points.
export {
  connectDdbNodePrivateRead, type DdbNodeTrustedReadEndpoint,
  type DdbNodePrivateReadTransportOptions, type DdbNodeAuthenticatedReadTransport,
} from './ddb-private-read-node';
export {
  verifyRegistryProof, verifyPlacementProof, verifyMptProof, providerSlot, PROVIDER_REGISTRY_RUNTIME_CODE_HASH, PLACEMENT_MANAGER_RUNTIME_CODE_HASH,
  type RegistryProofJSON, type PlacementRecordJSON, type ServedProvider, type ProviderRecordJSON, type ProofVerdict,
} from './ddb-proof';
export {
  buildDdbCapabilityToken, canonicalDdbCapabilityBytes, canonicalDdbCapabilityHash, normalizeRoleName,
  readDdbTokenLifetimeBound, verifyDdbCapabilityToken, DDB_TOKEN_LIFETIME_SLOT, DDB_TOKEN_MAX_SKEW, type VerifyDdbCapabilityOptions,
  DDB_CAPABILITY_DOMAIN, DDB_TOKEN_LIFETIME_MIN, DDB_TOKEN_LIFETIME_MAX, DDB_TOKEN_LIFETIME_DEFAULT,
  type DdbCapabilityToken, type DdbCapabilityFields, type BuildDdbCapabilityOptions,
} from './ddb-capability';
export {
  verifyHostGroupRecord, HOST_GROUP_RECORD_DOMAIN, HOST_GROUP_RECORD_HEAD_BYTES, type HostGroupRecordJSON,
} from './ddb-host-group';
export { Wallet, Signer, type TxParams } from './wallet';
// Offline private-transaction grammar/preparation; no corresponding submit RPC is enabled.
export * from './ddb-private-txn';
export { readDdbPrivateTransactionOutcome, collectDdbPrivateTransactionOutcome } from './ddb-private-txn-outcome';
export type { DdbPrivateTxnOutcomeResolver, DdbPrivateTxnOutcomeReadInput, DdbPrivateTxnFinalityCandidate,
  DdbPrivateTxnLocalDurable, DdbPrivateTxnLocalOutcome, DdbPrivateTxnExpectation, DdbPrivateTxnCollectionInput,
  DdbPrivateTxnHostDisposition, DdbPrivateTxnCollection } from './ddb-private-txn-outcome';
export * from './ddb-private-txn-online';
export {
  buildDdbCommitment, deriveDdbDigestKey, ddbPayloadCommitment, encodeDdbCommitmentEnvelope, decodeDdbCommitmentEnvelope,
  DDB_COMMITMENT_PAYLOAD_MAX_BYTES, type DdbCommitmentEnvelope, type DdbTagDelta, type DdbPayloadSidecar,
  type BuildDdbCommitmentInput, type BuiltDdbCommitment, type DdbPrivateIntent,
} from './ddb-commitment';
export {
  buildDdbDigestRotationPreview, buildDdbDigestRotation,
  type BuildDdbDigestRotationPreviewInput, type BuildDdbDigestRotationInput, type DdbDigestRotationExpected,
} from './ddb-digest-rotation';
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
