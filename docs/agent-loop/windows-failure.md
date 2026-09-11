# Windows concurrent-steering failure

PR103 Windows job102294844013 failed in fixture cleanup after387ms. Its
`Supervisor is stale` exception replaced any original test exception. The
published job log has no supervisor state/log snapshot, so the runtime cause
cannot be established from that stack trace alone.

This follow-up preserves both errors, prints temporary supervisor evidence,
and explicitly asserts the restarted supervisor is active. It does not skip
cleanup failures, loosen lifecycle checks, reclaim stale leases or change the
runtime. A failed evidence read cannot replace the test error.

Local native Windows Node22.23.2 passed the original11 tests; that is not a
reproduction of CI's Node24.19.0 environment. WSL integration checks pass after
the diagnostic change. Re-run the cross-OS CI matrix and use preserved evidence
to fix any reproducible underlying supervisor failure before claiming it solved.
