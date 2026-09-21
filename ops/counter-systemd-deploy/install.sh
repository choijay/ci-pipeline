#!/usr/bin/env bash
# Fresh install or update of the counter-demo systemd deployment package.
# Run in PuTTY as adolab: sudo bash install.sh --migrate
# Only counter-demo is stopped. No WAR is deleted/deployed/started by this installer.
set -euo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 027
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $EUID == 0 ]] || fail 'Run with sudo.'
[[ $# == 1 && "$1" == --migrate ]] || fail 'Usage: sudo bash install.sh --migrate (stops the current sample app)'
SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP=/srv/counter-demo
HOME_APP=/var/lib/counter-demo
UNIT=/etc/systemd/system/counter-demo.service
ADAPTER=/usr/local/lib/ci/deploy-war
HELPER=/usr/local/lib/ci/counter-demo-process
SUDOERS=/etc/sudoers.d/gitlab-counter-demo
CHECKS=/usr/local/lib/ci/counter-deployment-checks.jar
JDK=/usr/lib/jvm/java-17-openjdk-amd64/bin

for cmd in curl ss flock sudo visudo runuser systemctl systemd-analyze install; do
    command -v "$cmd" >/dev/null || fail "Missing prerequisite: $cmd"
done
[[ -x /usr/lib/jvm/java-17-openjdk-amd64/bin/java ]] || fail 'Ubuntu x64 OpenJDK 17 is required.'
[[ -x "$JDK/javac" && -x "$JDK/jar" ]] || fail 'OpenJDK 17 compiler and jar tool are required.'
id gitlab-runner >/dev/null 2>&1 || fail 'gitlab-runner OS account is missing.'
for f in deploy-war counter-demo.service gitlab-counter-demo.sudoers DeploymentChecks.java; do
    [[ -f "$SRC/$f" && ! -L "$SRC/$f" ]] || fail "Keep all package files together: $f"
done
bash -n "$SRC/deploy-war"
visudo -cf "$SRC/gitlab-counter-demo.sudoers"
systemd-analyze verify "$SRC/counter-demo.service"
# Validate current sudoers before touching it.
visudo -c

for p in /usr/local /usr/local/lib /usr/local/lib/ci /etc/systemd/system /etc/sudoers.d /srv /var/lib /var/backups /var/backups/counter-systemd-deploy; do
    if [[ -e "$p" || -L "$p" ]]; then
        [[ -d "$p" && ! -L "$p" && "$(stat -c %U "$p")" == root ]] || fail "Unsafe parent: $p"
        if runuser -u gitlab-runner -- test -w "$p"; then fail "Runner must not write $p"; fi
    fi
done
for f in "$ADAPTER" "$HELPER" "$UNIT" "$SUDOERS" "$CHECKS"; do
    if [[ -e "$f" || -L "$f" ]]; then
        [[ -f "$f" && ! -L "$f" && "$(stat -c %U "$f")" == root ]] || fail "Unsafe file: $f"
        (( (8#$(stat -c %a "$f") & 8#022) == 0 )) || fail "Group/world-writable file: $f"
    fi
done
for d in "$APP" "$APP/releases" "$HOME_APP"; do
    [[ ! -L "$d" && ( ! -e "$d" || -d "$d" ) ]] || fail "Unexpected directory/symlink: $d"
done
if id counter-demo >/dev/null 2>&1; then
    [[ "$(id -u counter-demo)" != 0 && "$(getent passwd counter-demo | cut -d: -f6)" == "$HOME_APP" ]] || fail 'Unexpected counter-demo OS account.'
fi
fragment="$(systemctl show counter-demo.service -p FragmentPath --value)"
[[ -z "$fragment" || "$fragment" == "$UNIT" ]] || fail "Unexpected service location: $fragment"
[[ -z "$(systemctl show counter-demo.service -p DropInPaths --value)" ]] || fail 'Custom service drop-ins found; review them before migrating.'
if [[ -f "$UNIT" ]]; then
    grep -Fxq 'User=counter-demo' "$UNIT" && grep -Fq '/srv/counter-demo/current/application.war' "$UNIT" || fail 'Existing service is not the supplied counter-demo sample.'
fi
if [[ -f "$HELPER" ]]; then
    fail 'Legacy direct-process helper found. Migrate it manually before using this systemd-only installer.'
fi
if [[ -e "$APP/current" || -L "$APP/current" ]]; then
    [[ -L "$APP/current" ]] || fail 'current must be a managed symlink.'
    target="$(readlink -f "$APP/current")"
    [[ "$(dirname "$target")" == "$APP/releases" && -f "$target/application.war" ]] || fail 'Existing current release is invalid.'
fi
# Compile and check the replacement before stopping the running application.
compiled="$(mktemp -d)"
trap 'rm -rf -- "$compiled"' EXIT
"$JDK/javac" --release 17 -d "$compiled" "$SRC/DeploymentChecks.java"
"$JDK/jar" --create --file "$compiled/checks.jar" --main-class DeploymentChecks -C "$compiled" DeploymentChecks.class
printf '{"value":0}' | "$JDK/java" -jar "$compiled/checks.jar" health
# Serialize migration with the existing adapter. No recursive ownership changes.
install -d -o gitlab-runner -g gitlab-runner -m 0755 "$APP" "$APP/releases"
[[ ! -L "$APP/.deploy.lock" ]] || fail 'Unexpected deployment-lock symlink.'
runuser -u gitlab-runner -- touch "$APP/.deploy.lock"
[[ -f "$APP/.deploy.lock" && ! -L "$APP/.deploy.lock" ]] || fail 'Invalid deployment lock.'
exec 9<"$APP/.deploy.lock"
flock -n 9 || fail 'A CD deployment is running. Wait for it to finish.'

backup="/var/backups/counter-systemd-deploy/$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -o root -g root -m 0700 "$backup"
for f in "$ADAPTER" "$HELPER" "$UNIT" "$SUDOERS" "$CHECKS"; do
    [[ ! -f "$f" ]] || cp -a -- "$f" "$backup/$(basename "$f")"
done
printf 'Backup: %s\n' "$backup"
printf 'Stopping only counter-demo. Downtime lasts until the next CD run/start.\n'
if [[ -f "$UNIT" ]]; then systemctl stop counter-demo.service; fi
[[ -z "$(ss -H -ltn 'sport = :18080')" ]] || fail 'Port 18080 is still occupied. No unrelated process was killed; migration stopped.'

if ! id counter-demo >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "$HOME_APP" --shell /usr/sbin/nologin counter-demo
fi
install -d -o counter-demo -g counter-demo -m 0750 "$HOME_APP"
install -d -o root -g root -m 0755 /usr/local/lib/ci
install -o root -g root -m 0644 "$compiled/checks.jar" "$CHECKS"
install -o root -g root -m 0755 "$SRC/deploy-war" "$ADAPTER"
install -o root -g root -m 0644 "$SRC/counter-demo.service" "$UNIT"
install -o root -g root -m 0440 "$SRC/gitlab-counter-demo.sudoers" "$SUDOERS"
visudo -c
systemctl daemon-reload
# A newly installed, inactive unit may not be loaded. Only clear actual failures.
if systemctl is-failed --quiet counter-demo.service; then
    systemctl reset-failed counter-demo.service
fi
systemctl enable counter-demo.service
printf '\nSystemd deployment installed; no new WAR was deployed or started.\n'
printf 'Existing WAR releases and current symlink were preserved.\n'
printf 'Next: run CD with CD_ENABLED=true and exact DEPLOY_VERSION/DEPLOY_SHA256.\n'
printf 'Existing current WAR can also be started with: sudo systemctl start counter-demo\n'
printf 'Port: 18080. Log: sudo journalctl -u counter-demo -f\n'
