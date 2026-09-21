// Runs only extracted reset/restart logic with shell functions as command mocks.
// Never sources the installer or executes real systemctl/sudo commands.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const bash = process.env.BASH_EXE || (process.platform === 'win32'
  ? 'C:/Program Files/Git/bin/bash.exe' : 'bash');
const installer = readFileSync(new URL('install.sh', root), 'utf8');
const adapter = readFileSync(new URL('deploy-war', root), 'utf8');
const installBlock = installer.match(/^if systemctl is-failed --quiet counter-demo\.service; then\n[\s\S]*?^fi\nsystemctl enable counter-demo\.service$/m)?.[0];
const restartBlock = adapter.match(/^restart_service\(\) \{\n[\s\S]*?^\}/m)?.[0];
assert.ok(installBlock, 'Installer reset guard and enable must exist');
assert.ok(restartBlock, 'Adapter restart function must exist');

function run(block, failed, resetError) {
  return spawnSync(bash, ['--noprofile', '--norc', '-s'], {
    encoding: 'utf8',
    input: `set -euo pipefail
systemctl() {
  printf '%s\\n' "$*"
  case "$1" in
    is-failed) return ${failed ? 0 : 1} ;;
    reset-failed) return ${resetError ? 7 : 0} ;;
    enable|restart) return 0 ;;
    *) return 99 ;;
  esac
}
sudo() { [[ "$1" == -n ]]; shift; "$@"; }
SYSTEMCTL=systemctl
SUDO=sudo
SERVICE=counter-demo.service
${block}
`,
  });
}

for (const [name, block, action] of [
  ['installer', installBlock, 'enable'],
  ['adapter', `${restartBlock}\nrestart_service`, 'restart'],
]) {
  test(`${name}: unloaded/inactive skips reset even when reset would fail`, () => {
    const result = run(block, false, true);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `is-failed --quiet counter-demo.service\n${action} counter-demo.service\n`);
  });
  test(`${name}: failed unit resets before ${action}`, () => {
    const result = run(block, true, false);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `is-failed --quiet counter-demo.service\nreset-failed counter-demo.service\n${action} counter-demo.service\n`);
  });
  test(`${name}: reset failure stops ${action}`, () => {
    const result = run(block, true, true);
    assert.equal(result.status, 7, result.stderr);
    assert.equal(result.stdout, 'is-failed --quiet counter-demo.service\nreset-failed counter-demo.service\n');
  });
}

for (const name of ['install.sh', 'deploy-war']) {
  test(`${name}: bash syntax`, () => {
    const result = spawnSync(bash, ['-n', fileURLToPath(new URL(name, root))], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });
}
