/**
 * Deploy an EVM contract, then read (call) and write (send) to it.
 *
 * Contract.deploy(...) broadcasts the deploy tx through the given deployer (a Signer or an unlocked
 * `from` address) and waits for the receipt with the created contractAddress. A `.call()` is a
 * read-only eth_call; a `.send()` is signed and broadcast through the Signer (ML-DSA-87).
 *
 * Replace the placeholder private key and bytecode with your own.
 */
import { Provider, Wallet, Contract } from 'necjs';

const RPC_URL = 'https://rpc.ncog.earth';
const DEPLOYER_PRIVATE_KEY = '0xYOUR_ML_DSA_87_PRIVATE_KEY_HEX';

// Minimal ABI for a simple storage contract: get() view + set(uint256) mutating.
const abi = [
  { inputs: [], name: 'get', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ name: 'value', type: 'uint256' }], name: 'set', outputs: [], stateMutability: 'nonpayable', type: 'function' },
];

// Replace with the compiled creation bytecode of your contract.
const bytecode = '0xYOUR_CONTRACT_CREATION_BYTECODE';

async function main() {
  const provider = new Provider(RPC_URL);
  const wallet = await Wallet.create(DEPLOYER_PRIVATE_KEY);
  const signer = wallet.connect(provider);

  // 1) Deploy. `deployer` may be a Signer (ISigner) or a from-address string for an unlocked
  //    node account. gasPrice/nonce/chainId are auto-filled by the Signer.
  const { contractAddress, txHash } = await Contract.deploy({
    abi,
    bytecode,
    provider,
    deployer: signer,
    constructorArgs: [],
    options: { from: wallet.address, gasLimit: '2000000' },
  });
  console.log('deployed at', contractAddress, '(deploy tx', txHash, ')');

  // 2) Attach and CALL a view method (read-only; no signature/gas).
  const contract = new Contract(contractAddress, abi, provider, signer);
  const current = await contract.methods.get().call();
  console.log('get() =>', current);

  // 3) SEND a mutating method (signed + broadcast via the Signer).
  const sendTxHash = await contract.methods.set(42).send({
    from: wallet.address,
    gasLimit: '100000',
    // gasPrice / nonce / chainId auto-filled by the Signer
  });
  console.log('set(42) tx', sendTxHash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
