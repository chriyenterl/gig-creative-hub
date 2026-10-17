#!/bin/sh
# Runs all server tests against a local copy of the Worker (wrangler dev, with local D1 + R2 — your
# real Cloudflare data is never touched). Needs Node.js and wrangler.
#   sh cloudflare/tests/run.sh
# Set WRANGLER to use a specific wrangler, e.g. WRANGLER=~/.gig-tools/wrangler/node_modules/.bin/wrangler
cd "$(dirname "$0")/.." || exit 1
W="${WRANGLER:-npx wrangler}"
export WRANGLER_SEND_METRICS=false
STATUS=0

run() { # run <test file> [extra wrangler args…]
  test="$1"; shift
  rm -rf .wrangler/test-state
  mkdir -p .wrangler
  $W dev --ip 127.0.0.1 --port 8787 --persist-to .wrangler/test-state "$@" > .wrangler/test-server.log 2>&1 &
  PID=$!
  i=0; until curl -s -m 2 http://127.0.0.1:8787/ > /dev/null 2>&1 || [ $i -ge 60 ]; do sleep 1; i=$((i + 1)); done
  echo "== $test"
  node "tests/$test" || STATUS=1
  kill $PID 2> /dev/null; pkill -f "wrangler dev --ip 127.0.0.1 --port 8787" 2> /dev/null; sleep 1
}

run api.test.mjs
run push.test.mjs
run email.test.mjs --var "RESEND_API_URL:http://127.0.0.1:9912/emails" --var "RESEND_API_KEY:test-key" --var "MAIL_FROM:GIG <noreply@example.test>"
rm -rf .wrangler/test-state
exit $STATUS
