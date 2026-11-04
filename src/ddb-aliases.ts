/**
 * Client-only names from the existing visible contract registry. Names and owners are reported
 * metadata, never authorization or a replacement for canonical contract/schema identity.
 */
export interface DdbContractAlias {
  /** Canonical decimal chain ID. A selection from another network is never reused implicitly. */
  readonly chainId: string;
  readonly ownerAddress: string;
  readonly contractName: string;
  readonly contractAddress: string;
  readonly dbName: string;
  /** Original spelling for the registry's textual address lookup; same full address as contractAddress. */
  readonly registryAddress: string;
}

export interface DdbContractAliasList {
  readonly aliases: readonly DdbContractAlias[];
  /** Node-wide count, NOT a count of this owner's hidden contracts. Omitted when the node omits it. */
  readonly withheldContracts?: number;
}

function invalid(reason: string): never {
  throw new Error(`ddb alias: ${reason}`);
}

export function aliasAddress(value: unknown): string {
  if (typeof value !== 'string' || !/^(?:0x)?[0-9a-f]{40}$/i.test(value.trim())) {
    return invalid('a full contract or owner address is required');
  }
  const hex = value.trim().replace(/^0x/i, '').toLowerCase();
  if (/^0{40}$/.test(hex)) return invalid('zero address is not a contract or owner');
  return '0x' + hex;
}

export function aliasChainId(value: unknown): string {
  if ((typeof value !== 'string' || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) &&
      (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)) {
    return invalid('a valid chain ID is required');
  }
  return BigInt(value).toString(10);
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('malformed registry metadata');
  }
  return value as Record<string, unknown>;
}

/** Copy the caller's selection before the first await, so mutation cannot retarget an in-flight use. */
export function aliasReference(value: unknown): DdbContractAlias {
  const r = object(value);
  const chainId = aliasChainId(r.chainId);
  const contractAddress = aliasAddress(r.contractAddress);
  const ownerAddress = aliasAddress(r.ownerAddress);
  if (typeof r.contractName !== 'string') return invalid('missing reported contract name');
  if (r.dbName !== 'c_' + contractAddress.slice(2)) return invalid('contract address/schema binding mismatch');
  if (typeof r.registryAddress !== 'string' || aliasAddress(r.registryAddress) !== contractAddress) {
    return invalid('registry lookup address does not match selected contract');
  }
  return Object.freeze({ chainId, contractAddress, ownerAddress, contractName: r.contractName,
    dbName: r.dbName as string, registryAddress: r.registryAddress });
}

export function aliasRegistry(value: unknown, chainId: string): DdbContractAliasList {
  const response = object(value);
  if (!Array.isArray(response.contracts)) return invalid('registry has no contracts array');
  const aliases: DdbContractAlias[] = [];
  const seen = new Set<string>();
  for (const raw of response.contracts) {
    const row = object(raw);
    // The public RPC withholds retired/restricted metadata. Do not treat an older/malformed
    // response that does not report retirement as a usable alias or reconstruct hidden names.
    if (row.tombstoned !== false) return invalid('registry retirement state is unavailable or retired');
    const alias = aliasReference({ chainId, contractAddress: row.contract_address,
      ownerAddress: row.owner_address, contractName: row.contract_name,
      dbName: row.db_name, registryAddress: row.contract_address });
    if (seen.has(alias.contractAddress)) return invalid('duplicate contract address in registry metadata');
    seen.add(alias.contractAddress);
    aliases.push(alias);
  }
  aliases.sort((a, b) => a.contractAddress < b.contractAddress ? -1 : a.contractAddress > b.contractAddress ? 1 : 0);
  if (response.withheldContracts !== undefined &&
      (typeof response.withheldContracts !== 'number' || !Number.isSafeInteger(response.withheldContracts) || response.withheldContracts < 0)) {
    return invalid('malformed withheld-contract count');
  }
  return Object.freeze({ aliases: Object.freeze(aliases),
    ...(response.withheldContracts === undefined ? {} : { withheldContracts: response.withheldContracts as number }) });
}

export function assertAliasMetadata(selected: DdbContractAlias, response: unknown): void {
  const rows = aliasRegistry(response, selected.chainId).aliases;
  // A point lookup must identify this one contract. Never let the first unrelated row choose
  // the schema or label, even if a later row matches or both names/owners happen to be equal.
  if (rows.length !== 1 || rows[0].contractAddress !== selected.contractAddress || rows[0].dbName !== selected.dbName) {
    invalid('point metadata does not identify the selected contract and schema');
  }
  if (rows[0].ownerAddress !== selected.ownerAddress || rows[0].contractName !== selected.contractName) {
    invalid('selected owner or reported name has changed');
  }
}
