#!/usr/bin/env bash
# End-to-end check of the web app against a stub API.
#
# Proves the journey a user actually takes — sign in, land on home, switch
# language, sign out — rather than only that pages render. Runs without a
# database, so it is fast enough to run on every change.
#
#   bash test/e2e.sh
set -uo pipefail

PORT=${PORT:-5199}
STUB_PORT=4111
export SESSION_SECRET="${SESSION_SECRET:-0123456789012345678901234567890123456789}"
export API_URL="http://127.0.0.1:${STUB_PORT}/api/v1"

node test/stub-api.mjs > /tmp/tf-stub.log 2>&1 &
STUB=$!
npx react-router dev --port "$PORT" > /tmp/tf-web.log 2>&1 &
WEB=$!
trap 'kill $STUB $WEB 2>/dev/null' EXIT

for _ in $(seq 1 40); do sleep 2; grep -q "Local:" /tmp/tf-web.log && break; done
sleep 6

BASE="http://127.0.0.1:${PORT}"
JAR=$(mktemp)
PASS=0; FAIL=0
pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }

echo "1. signed out"
[[ "$(curl -s -o /dev/null -w '%{redirect_url}' "$BASE/")" == *"/login"* ]] \
  && pass "/ redirects to /login" || fail "/ did not redirect"

echo "2. wrong password"
curl -s -c "$JAR" -X POST "$BASE/login" -d "email=a@b.test&password=wrong" | grep -q "not recognised" \
  && pass "shows the translated error" || fail "no error shown"
grep -q taskforge_session "$JAR" && fail "cookie set on a failed sign-in" || pass "no cookie on failure"

echo "3. sign in"
rm -f "$JAR"
curl -s -o /dev/null -c "$JAR" -D /tmp/tf-h.txt -X POST "$BASE/login" \
  -d "email=pm@taskforge.test&password=TaskForge123!&redirectTo=/"
grep -qi "set-cookie: taskforge_session" /tmp/tf-h.txt && pass "session cookie issued" || fail "no cookie"
grep -qi "set-cookie.*httponly"          /tmp/tf-h.txt && pass "cookie is httpOnly"  || fail "not httpOnly"
grep -qi "^location: /"                  /tmp/tf-h.txt && pass "redirects home"      || fail "no redirect"

echo "4. home"
HOME_HTML=$(curl -s -b "$JAR" "$BASE/")
grep -q "Priya Nair"      <<< "$HOME_HTML" && pass "greets by name"    || fail "name missing"
grep -q "Project manager" <<< "$HOME_HTML" && pass "role badge"        || fail "role missing"
grep -q "Moob02 Software" <<< "$HOME_HTML" && pass "organisation"      || fail "org missing"

echo "5. already signed in"
[[ -n "$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" "$BASE/login")" ]] \
  && pass "/login redirects away" || fail "login form shown to a signed-in user"

echo "6. language"
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/locale" -d "locale=ar" -e "$BASE/"
AR=$(curl -s -b "$JAR" "$BASE/")
grep -q 'dir="rtl"' <<< "$AR" && pass "flips to RTL"      || fail "still LTR"
grep -q "أهلًا"      <<< "$AR" && pass "renders in Arabic" || fail "not translated"

echo "7. account screen"
ACC=$(curl -s -b "$JAR" "$BASE/account")
grep -q "Change password"     <<< "$ACC" && pass "change-password form" || fail "no change-password form"
grep -q "Sign out everywhere" <<< "$ACC" && pass "sign-out-everywhere"  || fail "no sign-out-everywhere"
curl -s -b "$JAR" -X POST "$BASE/account" \
  -d "intent=changePassword&currentPassword=nope&newPassword=aaaaaaaaaaaa&confirmPassword=aaaaaaaaaaaa" \
  | grep -q "Incorrect password" && pass "wrong current password → field error" || fail "no field error"
curl -s -b "$JAR" -X POST "$BASE/account" -d "intent=signOutEverywhere" \
  | grep -q "Signed out of" && pass "sign out everywhere reports a count" || fail "no count"

echo "8. projects"
L=$(curl -s -b "$JAR" "$BASE/projects")
grep -q "FreshCart Web" <<< "$L" && pass "project list"     || fail "no projects"
grep -q "New project"   <<< "$L" && pass "PM create button" || fail "no create button"

N=$(curl -s -b "$JAR" "$BASE/projects/new")
grep -q "Project details"      <<< "$N" && pass "wizard step 1" || fail "step 1"
grep -q "Invite your team"     <<< "$N" && pass "wizard step 2" || fail "step 2"
grep -q "What the client sees" <<< "$N" && pass "wizard step 3" || fail "step 3"
grep -q "Internal comments are never shown" <<< "$N" \
  && pass "internal-comment rule stated" || fail "rule not stated"

LOC=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" -X POST "$BASE/projects/new" \
  -d "name=FreshCart Web&key=WEB&preset=OPEN")
[[ "$LOC" == *"/projects/WEB"* ]] && pass "create redirects to the project" || fail "no redirect"

curl -s -b "$JAR" -X POST "$BASE/projects/new" -d "name=X&key=DUPE&preset=OPEN" \
  | grep -q "already exists" && pass "duplicate key rejected" || fail "duplicate key accepted"

V=$(curl -s -b "$JAR" "$BASE/projects/WEB")
grep -q "Invite someone"      <<< "$V" && pass "invite form"        || fail "no invite form"
grep -q "newdev@example.test" <<< "$V" && pass "pending invitation" || fail "no pending invite"

echo "9. accept invitation"
A=$(curl -s "$BASE/accept-invite?token=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
# The apostrophe in "You have been invited" is HTML-escaped, so match a safe part.
grep -q "been invited"    <<< "$A" && pass "preview renders"   || fail "no preview"
grep -q "FreshCart Web"   <<< "$A" && pass "names the project" || fail "project name missing"
grep -q 'name="password"' <<< "$A" && pass "asks for password" || fail "no password field"

curl -s "$BASE/accept-invite?token=expired-token-000000000000000000" \
  | grep -q "no longer valid" && pass "expired invitation refused" || fail "expired accepted"

echo "10. expired token recovers instead of crashing"
# The bug this exists to prevent: an access token expires while a tab is open,
# and every page throws "Token has expired" with a stack trace. Simulated by
# asking the refresh route to run directly, which is what requireUser does.
R=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" -c "$JAR" "$BASE/refresh-session?next=%2Fprojects")
[[ "$R" == *"/projects"* ]] && pass "refresh returns you where you were" || fail "refresh went to $R"
curl -s -b "$JAR" "$BASE/projects" | grep -q "FreshCart Web" \
  && pass "still signed in after refresh" || fail "lost the session on refresh"
# An off-site next= must not be honoured.
O=$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" -c "$JAR" "$BASE/refresh-session?next=https%3A%2F%2Fevil.test")
[[ "$O" != *"evil.test"* ]] && pass "open redirect refused" || fail "OPEN REDIRECT via next="

echo "11. form validation"
N=$(curl -s -b "$JAR" "$BASE/projects/new")
grep -q 'pattern="\[A-Za-z\]{2,8}"' <<< "$N" && pass "key has a pattern"   || fail "no pattern on key"
grep -qi 'maxlength="8"'              <<< "$N" && pass "key capped at 8"     || fail "key uncapped"
grep -qi 'maxlength="120"'            <<< "$N" && pass "name capped at 120"  || fail "name uncapped"
# noValidate would silently disable required, type=email and pattern everywhere.
for PAGE in login register forgot-password; do
  curl -s "$BASE/$PAGE" | grep -qi 'novalidate' \
    && fail "$PAGE disables browser validation" || pass "$PAGE validates in the browser"
done
curl -s -b "$JAR" -X POST "$BASE/projects/new" -d "name=X&key=22544545&preset=OPEN" \
  | grep -q "Letters only" && pass "server rejects a numeric key" || fail "server accepted digits"

echo "12. destructive actions ask first"
V=$(curl -s -b "$JAR" "$BASE/projects/WEB")
grep -q "Revoke this invitation?"        <<< "$V" && pass "revoke confirms"        || fail "revoke does not confirm"
grep -q "Remove Rahim Chowdhury from"    <<< "$V" && pass "remove names the person" || fail "remove not specific"
grep -q "<dialog"                        <<< "$V" && pass "native dialog"          || fail "no dialog element"
grep -q 'aria-labelledby="confirm-title"'<<< "$V" && pass "dialog is labelled"     || fail "unlabelled"
# A confirmation that only works with JS would disable the action entirely
# without it. The trigger stays a real submit button.
grep -q 'type="submit"'                  <<< "$V" && pass "works without JS"       || fail "JS-only"
curl -s -b "$JAR" "$BASE/account" | grep -q "Sign out on all other devices?" \
  && pass "sign-out-everywhere confirms" || fail "no confirmation"

echo "13. staffing a project without email"
# Invitations are for people with no account. Someone already in the workspace
# should be addable directly — the endpoints existed for a while with no UI.
V=$(curl -s -b "$JAR" "$BASE/projects/WEB")
grep -q "Add someone already on your team" <<< "$V" && pass "add-existing panel"  || fail "no add-existing panel"
grep -q "Yusuf Demir"                      <<< "$V" && pass "lists assignable people" || fail "no candidates"
grep -q 'name="userId"'                    <<< "$V" && pass "posts a user id"     || fail "no userId field"

echo "14. sign out"
curl -s -o /dev/null -b "$JAR" -c "$JAR" -X POST "$BASE/logout"
[[ "$(curl -s -o /dev/null -w '%{redirect_url}' -b "$JAR" "$BASE/")" == *"/login"* ]] \
  && pass "session cleared" || fail "still signed in"

echo ""
echo "  $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]] || exit 1
