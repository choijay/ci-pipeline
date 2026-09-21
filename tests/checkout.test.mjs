import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import test from 'node:test';

test('checkout uses the pinned commit and rejects missing or invalid commits', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-checkout-'));
  const server = join(root, 'server');
  const repo = join(server, 'hanwha', 'ci-pipeline.git');
  const app = join(root, 'app');
  mkdirSync(repo, { recursive: true });
  mkdirSync(app);
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    git('config', 'user.name', 'Local checkout test');
    git('config', 'user.email', 'local-test@example.invalid');
    writeFileSync(join(repo, 'helper.gradle'), 'pinned contents\n');
    git('add', '.');
    git('commit', '-qm', 'pinned');
    const sha = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, 'helper.gradle'), 'newer contents\n');
    git('commit', '-qam', 'newer');
    const yaml = readFileSync(new URL('../.gitlab/gradle.yml', import.meta.url), 'utf8');
    const script = yaml.split('    - |')[1].replace(/^      /gm, '');
    const run = ref => spawnSync('C:/Program Files/Git/bin/bash.exe', ['-s'], {
      cwd: app,
      encoding: 'utf8',
      env: { ...process.env, CI_PROJECT_DIR: app.replaceAll('\\', '/'),
        PIPELINE_GIT_BASE_URL: server.replaceAll('\\', '/'), PIPELINE_PROJECT: 'hanwha/ci-pipeline',
        PIPELINE_REF: ref, CI_JOB_TOKEN: 'local-test-placeholder' },
      input: 'export PATH=/usr/bin:/bin:$PATH\n' + script + '\ncat "$PIPELINE_DIR/helper.gradle"\n',
    });
    const pinned = run(sha);
    assert.equal(pinned.status, 0, pinned.stderr);
    assert.equal(pinned.stdout.trim(), 'pinned contents');
    assert.notEqual(run('f'.repeat(40)).status, 0);
    assert.notEqual(run('main').status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
