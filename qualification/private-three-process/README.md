# NEC-93 actual three-process private transport witness

SOURCE ONLY. All seven cases in cases.json remain DEFERRED; BASIC=0. No command below was run by the source author. No build or deployment artifact is supplied here. This harness adds the previously missing actual Go-ingress composition; it preserves the existing SDK same-process WSS/PQ and Go actual PostgreSQL cases as separate required evidence.

The three role processes are an actual SDK client (`client.cjs`), the production Go Service private tunnel in an opt-in gossip test-binary helper (`TestPrivateTunnelThreeProcessIngressHelper`), and a separate selected-host HTTPS server (`selected-host.cjs`). A bounded Python supervisor owns all three children, pipes, logs and cleanup. It starts no shell/daemon, retries no private request, never changes an existing evidence directory, and kills/waits every owned role on failure. Each role has a hard deadline; individual TLS/channel deadlines and byte ceilings remain active. The helper's ephemeral listener reservation race fails visibly rather than choosing a replacement connection.

The Go helper uses the existing `custodyAssignmentFixture`, real retained state tries, reviewed manager runtime and actual EndpointDirectory publication/getter bytecode. It publishes the separate selected-host HTTPS endpoint and SPKI pin from the test SFC-authorized account in a completed fixture state, resolves actual current assignment evidence, and starts/stops the unchanged production `Service.startDdbPrivateTunnel` / `stopDdbPrivateTunnel`. No assignment or endpoint authorization callback is stubbed. As in the existing trusted tunnel tests, completed fixture headers and initial SFC/placement state are test construction, not a live block-engine/governance proof. Current and retained-original authority/move/forged history remain qualified by `TestPrivateTunnelTrustedCurrentAndRetainedOriginal` separately; this transport harness exercises the current audience only.

The selected host is explicitly a transport fixture. It negotiates real TLS1.3/X25519MLKEM768/AES256GCM and verifies actual private token ML-DSA signatures plus the exact audience and literal token select/procedure params before returning known rows. Its preview/sidecar endpoints only verify sentinel transport. They do not execute a private preview, ingest durable custody or certify SQL/finality. Existing actual `TestPrivateCapabilityRPCPostgres*` tests qualify real keyed private snapshots, RBAC and publication; the complete existing transaction/custody suites retain their independent obligations. Client assignment equality uses the supervisor-owned exact fixture record as its trusted test input; it is not offered as a production chain-proof policy. Actual SDK connection success/identity flags come only from the real selected-host TLS factory.

The helper wraps HTTP Hijack for capture only, delegating the unchanged production handler. This observes WebSocket frames after ingress outer TLS is decrypted. Assertions explicitly decode headers and unmask client frames before checking sentinels; a raw masked-frame substring scan would be insufficient. Captures are bounded to 8 MiB and twelve owned connections. Four positive requests include real private `ddb_tokenSelect`, `ddb_tokenCallReadProcedure`, preview and sidecar sentinels; two negative requests require actual inner-pin refusal and actual Go nonmember-route refusal before private HTTP. One-use is exercised after every positive socket. Reports must prove distinct role PIDs, exactly four selected-host HTTP requests, five actual selected-host TLS handshakes (including wrong pin), six outer tunnels, and no plaintext token/query/arg/row/preview/sidecar in decoded Go-ingress payloads.

## Root Azure preparation (not run)

Use the exact merged source tuple and existing dependency environment; no package install, node_modules mutation, main checkout change, EVM edit, feature activation or publication is needed. Preserve the separately qualified private EVM dependency (2b lineage) and root's existing Go wrapper/flock. Build the gossip package test helper, for example in the root-authorized shell/wrapper:

```sh
# Under the existing root Go/flock wrapper, from the coherent Node worktree:
go test -c -o /absolute/owned/scratch/gossip-private-three.test ./gossip
```

First run the ordinary touched Node/SDK/PG suites, type-check the whole merged SDK/native source, and run the existing same-process PQ fixture using the existing installed dependencies. The actual Node/OpenSSL build must expose the required hybrid group; the factory itself refuses a classical or unavailable profile. The harness does not spoof a group or weaken CA/name/SPKI checks.

Then run this supervisor under root's serialized Azure runtime authorization, using a NEW owned evidence directory and the existing ts-node register path (override if dependencies live outside this checkout):

```sh
python3 qualification/private-three-process/run.py \
  --go-test-binary /absolute/owned/scratch/gossip-private-three.test \
  --node /absolute/path/to/approved/node \
  --ts-node-register /absolute/existing/dependencies/node_modules/ts-node/register/transpile-only.js \
  --output /absolute/owned/evidence/nec93-private-three-01
```

The supervisor never builds or installs automatically. It records `host.json`, `client.json`, `ingress.json`, readiness/config records, bounded role logs, captured frame files and `RESULT.json` (or `FAILED.json`). `RESULT.json` keeps BASIC=0 until root reviews exact source/dependency tuples and accepts the runtime evidence; merely writing/running the harness does not transfer any historical BASIC. The raw capture/config/report artifacts contain test fixtures only, including full test token signatures. Retain or gzip them as root evidence; delete no unrelated files.

`assertions.py` and cases.json were committed before driver/helper implementation at SDK fec7e96. No semantic baseline RED was executed locally; missing helpers/files or compiler failures do not count. Test-first source contract: without actual role reports/captures assertions refuse, and a false same-process/fake-transport report cannot satisfy the distinct PID, exact method and real-capture requirements. Root must still execute meaningful semantic controls, restore exact source and rerun GREEN.

## Focused controls and remaining limits

Keep the reviewed actual inner-SPKI comparison control: remove only the actual selected-host pin check, run the wrong-pin case, require a causal failure, restore its exact blob SHA and rerun all seven bounded cases. The existing validated-IP-binding author/control witnesses remain separate. A reviewer can additionally omit only `authorizeCapabilityRole` in the private read handler and require actual PG cached-revoke to turn RED; that SQL control cannot be replaced by this transport fixture.

No browser/RN Node runtime import is added. Native retained-original transaction context and all original required-host obligations remain in the reviewed native/source suites. This harness does not prove retention availability, live handoff/recovery, classical certificate signatures becoming PQ authentication, or deployment readiness. The explicit helper skips in normal component runs unless NEC93_PRIVATE_THREE_PROCESS_CONFIG is supplied; root must list it as an intentional helper-only skip rather than count an unselected/default run as a pass.
