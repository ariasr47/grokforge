# Claim shapes

| Shape | Template | Example |
| --- | --- | --- |
| Mechanism | "X works by Y so Z is observable." | "Isolation works by process-boundary + timeout so a hung worker cannot block the request path." |
| Assumption | "I assume A; if false, B breaks." | "I assume FE owns reconnect UI; if false, recovery copy is missing from my non-goals." |
| Non-goal | "We explicitly do not do N because M." | "We do not offer multi-region failover in v1 because cost exceeds the BRIEF scope." |

Reject: "the system will handle errors" with no path, owner, or user-visible outcome.
