# ADR-0001: Unity licensing and cloud execution gate

*Status: CONDITIONAL GO — explicit project-owner authorization for controlled implementation; commercial beta remains conditional on external legal confirmation*  
*Date: 2026-08-30*

## Decision

The project owner explicitly authorizes completion of the implementation and fixture-based acceptance for this workspace. That authorization is scoped to one controlled local/fixture worker and does not represent legal advice or a Unity commercial license grant. Commercial SaaS beta remains NO-GO until the accountable organization records the applicable Unity terms and external legal confirmation.

## Required signed record

| Field | Value | State |
|---|---|---|
| Approver | **TBD — accountable organization representative** | Missing |
| Organization / legal entity | **TBD — legal entity must be named** | Missing |
| Applicable Unity tier / Build Server terms | **TBD — must cite the applicable account terms and hosted-worker/SaaS scope** | Missing |
| Approved concurrent Editor/build capacity | **TBD — no hosted capacity is approved** | Missing |
| Scope: SaaS, hosted workers, user projects | **TBD — must explicitly cover cloud Editor, Build Server and user-generated projects** | Missing |
| Review / expiry date | **TBD — supplied by the signer** | Missing |
| Go/no-go decision | **NO-GO for commercial beta and hosted workers until every field above is signed** | Enforced |
| Signature / approval reference | **TBD — signed external record required; do not use a task/chat approval as a substitute** | Missing |

The project owner's task authorization permits engineering work only. It is not a signed Unity agreement or legal approval. The scheduler and both deployables must fail closed when the signed decision reference, positive capacity, or expiry is absent/expired. Populate this table only from an externally signed record; never infer it from source control, a chat message, or a fixture test.

## Consequences

- License inventory, leases, quarantine and capacity limits are modeled in the data layer and tested without storing credentials.
- Production configuration requires `UNITY_LICENSE_DECISION_REF` (`signed://...`), `UNITY_LICENSE_APPROVED_CAPACITY` and a future `UNITY_LICENSE_EXPIRES_AT`; the current workspace intentionally has none of these signed values.
- A worker may be used for local contract or fixture tests only when the host has its own valid license; the platform must fail closed when availability is unknown.
- No generated source, container, log or preview may contain a license token or raw license file.
