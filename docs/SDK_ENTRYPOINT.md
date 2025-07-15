# SDK Entry Point

The main entry point for the SDK is:

[src/index.ts](../src/index.ts)

---

## Main Exports

- **Provider**: JSON-RPC client for blockchain nodes.
- **Wallet, Signer**: Private key wallet, post-quantum cryptography, transaction signing.
- **Contract**: Smart contract interaction (web3.js-style methods).
- **ContractFactory**: Deploy and attach to contracts.
- **InjectedProvider, ExtensionSigner**: Browser extension wallet integration.
- **Subscription**: WebSocket-based real-time event subscriptions.
- **loadWasm, loadWasmFromBuffer, MlKem**: Post-quantum cryptography (MLKEM) loader and interface.

See the [API Reference](API_REFERENCE.md) for details on each module. 