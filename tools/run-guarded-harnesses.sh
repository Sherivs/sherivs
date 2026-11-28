#!/usr/bin/env bash
# Runs the integration harnesses that refuse any database not named (and marked) for them.
# usage: tools/run-guarded-harnesses.sh <superuser-url-without-db> <built-chain-db>
#   e.g. tools/run-guarded-harnesses.sh postgresql://postgres@127.0.0.1:54329 chain
# <built-chain-db> is a database where every migration has been applied (tools/sim-lab/migrate.mjs). Each harness gets
# a clone of it under the exact name it requires, is run once, and the clone is dropped. Local disposable servers only.
set -u
SU=${1:?superuser url without a database}; SRC=${2:?built chain database}
case "$SU" in *127.0.0.1*|*localhost*|*"[::1]"*) ;; *) echo "refusing non-local server" >&2; exit 2;; esac
fail=0
run() { # harness-file target-db pgoptions pass-pattern
  local f=$1 db=$2 opts=$3 pat=$4 out
  psql "$SU/template1" -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" -c "CREATE DATABASE $db TEMPLATE $SRC" >/dev/null 2>&1 \
    || { echo "FAIL  $f: could not clone $SRC to $db (is $SRC idle?)"; fail=1; return; }
  out=$(PGOPTIONS="$opts" psql "$SU/$db" -v ON_ERROR_STOP=1 -f "tests/integration/$f.local.sql" 2>&1)
  if echo "$out" | grep -Eq "$pat" && ! echo "$out" | grep -Eq "(^|[^A-Za-z])ERROR:"; then echo "PASS  $f ($db)"; else echo "FAIL  $f ($db)"; echo "$out" | grep -E "ERROR|FAIL" | head -3; fail=1; fi
  psql "$SU/template1" -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
}
run m009-a1-role-engine          m009_a1_scratch_test        ""                                                  "M009-A1 ALL PASS"
run m009-b1-authority            m009_b1_authority_test      "-c m009b1.test_disposable_database=on"             "M009-B1 AUTHORITY ALL PASS"
run m009-b5-authority            m009_b5_authority_test      "-c m009b5.test_disposable_database=on"             "M009-B5 AUTHORITY ALL PASS"
run engine01-person-twin         engine_chain                "-c coregrid.test_disposable_database=on"           "ENGINE-01 HARNESS PASSED"
run engine02-conductor-compat    engine_chain                "-c coregrid.test_disposable_database=on"           "ENGINE-02 HARNESS PASSED"
run engine03-tool-broker         engine_chain                "-c coregrid.test_disposable_database=on"           "ENGINE-03 HARNESS PASSED"
run coregrid-memory-isolation    coregrid_memory_test        "-c coregrid.test_disposable_database=on"           "ALL PASS"
run sv1-twin-gate                coregrid_twin_test          "-c coregrid.test_disposable_database=on"           "ALL PASS"
run sv1-twin-personal            coregrid_twin_test          "-c coregrid.test_disposable_database=on"           "ALL PASS"
run comms-03-sms-dispatch-financials comms_03_scratch_test   ""                                                  "COMMS-03 RESULT: pass=[0-9]+ fail=0"
run fin-01-wallet-authorization  fin_01_scratch_test         ""                                                  "FIN-01 RESULT: pass=[0-9]+ fail=0"
run ent-01-subscription-authorization ent_01_scratch_test    ""                                                  "ENT-01 RESULT: pass=[0-9]+ fail=0"
exit $fail
