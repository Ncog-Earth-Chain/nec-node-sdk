# Optional opaque private tunnel

Use Node/native TLS options `tunnel: { chainId, ingressURL, ca? }` on the host
transport. `ingressURL` is an explicit HTTPS origin plus the exact
`/ddb/private-tunnel/v1` path. Keep selected-host `ca` separate from ingress `ca`.
The connector projects only the already authenticated public assignment and
selected validator ID. It then performs the existing real inner TLS handshake
over one WSS binary stream: CA/name/SPKI, TLS 1.3, X25519MLKEM768,
TLS_AES_256_GCM_SHA384, no resumed session and the exact one-use socket. Outer
ingress TLS never sets selected-host authentication assertions.

`createDdbNodePrivateTunnelDialer` also returns a raw `socketDialer` for an
application that independently owns a current/original public assignment route.
It has no private signer, payload, token or RPC forwarding API. Supplying both
automatic `tunnel` and `socketDialer` refuses. Evidence-source channels remain
explicit/direct and do not recursively tunnel themselves.

Retained collection captures `{txnId, originalPlacement}` only after exact
retained BASE matching and historical membership verification. The trusted policy
also rereads that original assignment from its explicit authenticated source and
resolves the stable-ID endpoint from current trusted state. The Node custody
connector requires this context when tunneling; it does not substitute the newest
group. Its outer audience is `retained-original`; only the existing signed outcome
read travels inside TLS. Direct custody calls remain compatible without context.

The carrier has no retry/replacement/redirect/compression/multiplexing behavior.
Tunneled read transports set `noRouteRefresh`, so even structured stale-route
responses cannot cause another automatic stream. Submission uncertainty remains
unknown and the original signed members, ID and required-host obligations remain.

Certificates still use classical authentication. Hybrid key exchange supplies
the existing confidentiality profile; this does not add PQ server authentication,
browser TLS attestation, mobile support, a host challenge purpose or a chain proof.
