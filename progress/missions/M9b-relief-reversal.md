# M9B relief reversal

Status: draft PR, not applied anywhere.
Built: migration 20261128000100, rollback (refuses if a reversal exists), harness tests/integration/m9b-relief-reversal.local.sql (M9R ALL PASS: 20 checks), CI step, ADR-157.
Evidence: harness passes; with the rollback applied the harness fails at its presence guard; re-apply passes again; M07 harness (M07 ALL PASS) still passes on the changed ledger.
Not built: a screen for it; handling of relief revoked-and-posted before this change (see ADR-157, none expected); levies.
Tumi to check: any hosted data with revoked relief that was posted.
