import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

test('JDK-only deployment validation and counter health', () => {
  const temp = mkdtempSync(join(tmpdir(), 'deployment-checks-'));
  const run = (cmd, args, input) => spawnSync(cmd, args, { encoding: 'utf8', input });
  try {
    const compile = run('javac', ['--release', '17', '-d', temp,
      fileURLToPath(new URL('../ops/counter-systemd-deploy/DeploymentChecks.java', import.meta.url)),
      fileURLToPath(new URL('./DeploymentChecksTest.java', import.meta.url))]);
    assert.equal(compile.status, 0, compile.stderr);
    const fixture = run('java', ['-cp', temp, 'DeploymentChecksTest', join(temp, 'fixture')]);
    assert.equal(fixture.status, 0, fixture.stderr);
    assert.match(fixture.stdout, /11 checks passed/);
    for (const [body, ok] of [
      ['{"value":0}', true], [' { "value" : -42 }\n', true],
      ['{"value":9223372036854775807}', true], ['{"value":1.5}', false],
      ['{"value":"1"}', false], ['{"value":true}', false], ['{"value":01}', false],
      ['{"value":1} trailing', false], ['{"nested":{"value":1}}', false],
    ]) {
      const health = run('java', ['-cp', temp, 'DeploymentChecks', 'health'], body);
      assert.equal(health.status === 0, ok, body + ': ' + health.stderr);
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
