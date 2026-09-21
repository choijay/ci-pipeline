import { readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('unit tests run without fetching another repository', () => {
  const ci = read('.gitlab/ci.yml');
  assert.doesNotMatch(ci, /PIPELINE_TOOLS_DIR|\.pipeline_tools|CI_JOB_TOKEN|git fetch/);
  assert.doesNotMatch(read('templates/java-war.yml'), /bootstrap\.yml/);
  assert.equal(existsSync(new URL('../.gitlab/bootstrap.yml', import.meta.url)), false);
});

test('CI and CD contain no Python runtime invocation', () => {
  for (const name of ['.gitlab/ci.yml', '.gitlab/cd.yml']) {
    assert.doesNotMatch(read(name), /python3?|release\.py|ci\/deploy\.sh/);
  }
});

test('Gradle helpers remain separate files in the pipeline repository', () => {
  const jobs = read('.gitlab/ci.yml');
  assert.doesNotMatch(jobs, /(?:-I|-p) ci\//);
  assert.equal(jobs.match(/!reference \[.pipeline_checkout, script\]/g).length, 3);
  for (const name of ['ci/gradle-security.init.gradle', 'ci/gradle-war.init.gradle', 'ci/publish/build.gradle', 'ci/publish/settings.gradle']) {
    assert.ok(read(name).length > 50);
  }
  assert.doesNotMatch(read('.gitlab/gradle.yml'), /heredoc|cat >|gradle.beforeProject|plugins \{/);
});

test('systemd deployment and installation need no Python runtime', () => {
  for (const name of ['install.sh', 'deploy-war']) {
    assert.doesNotMatch(read('ops/counter-systemd-deploy/' + name), /python3?/);
  }
});
