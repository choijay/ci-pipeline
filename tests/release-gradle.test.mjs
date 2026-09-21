import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import test from 'node:test';

test('inline Gradle tasks preserve release/checksum and Nexus validation', { timeout: 240000 }, async () => {
  assert.ok(process.env.GRADLE_TEST_HOME, 'Set GRADLE_TEST_HOME to an existing Gradle 8.14.5 distribution');
  const temp = mkdtempSync(join(tmpdir(), 'inline-release-'));
  let server;
  try {
    const app = join(temp, 'app'), tools = join(temp, 'release');
    mkdirSync(join(app, 'dist'), { recursive: true }); mkdirSync(tools);
    const yaml = readFileSync(new URL('../.gitlab/release.yml', import.meta.url), 'utf8');
    const code = yaml.split("<<'GRADLE'\n")[1].split('\n      GRADLE')[0].split('\n').map(line => line.slice(6)).join('\n');
    writeFileSync(join(tools, 'settings.gradle'), "rootProject.name='offline-release-test'\n");
    writeFileSync(join(tools, 'build.gradle'), code + `
tasks.register('localReleaseTests') {
    doLast {
        def invoke = { name -> tasks.named(name).get().with { t -> t.actions.each { it.execute(t) } } }
        def requireFailure = { action ->
            boolean rejected = false
            try { action() } catch (Exception expected) { rejected = true }
            assert rejected : 'Invalid release was accepted'
        }
        invoke('createRelease')
        def metadataFile = new File(System.getenv('CI_PROJECT_DIR'), 'dist/release.json')
        def data = new groovy.json.JsonSlurper().parse(metadataFile)
        assert data.version == '0.1.0-build.321'
        assert data.pipelineId == '234'
        assert data.packageJobId == '321'
        invoke('verifyLocal')
        def original = metadataFile.text
        metadataFile.text = original.replace('"projectId": "17"', '"projectId": "99"')
        requireFailure { invoke('verifyLocal') }
        metadataFile.text = original.replace('"schemaVersion": 1', '"schemaVersion": 2')
        requireFailure { invoke('verifyLocal') }
        metadataFile.text = original
        def war = new File(System.getenv('CI_PROJECT_DIR'), 'dist/application.war')
        def originalWar = war.bytes
        war.bytes = 'not a WAR'.bytes
        requireFailure { invoke('verifyLocal') }
        war.bytes = originalWar
        metadataFile.text = original.replace(data.sha256, '0' * 64)
        requireFailure { invoke('verifyLocal') }
        metadataFile.text = original
        println('RELEASE_CHECKS_PASSED')
    }
}
tasks.register('localRemoteTests') {
    doLast {
        def invoke = { name -> tasks.named(name).get().with { t -> t.actions.each { it.execute(t) } } }
        def remoteRoot = new File(System.getenv('CI_PROJECT_DIR'))
        invoke('fetchRelease')
        assert new File(remoteRoot, 'deploy/application.war').bytes == new File(remoteRoot, 'dist/application.war').bytes
        ['redirect', 'checksum', 'project', 'oversized'].each { mode ->
            new File(remoteRoot, 'mode').text = mode
            boolean rejected = false
            try { invoke('fetchRelease') } catch (Exception expected) { rejected = true }
            assert rejected : 'Invalid Nexus response accepted: ' + mode
        }
        println('NEXUS_CHECKS_PASSED')
    }
}
`);
    mkdirSync(join(temp, 'zip/WEB-INF'), { recursive: true });
    writeFileSync(join(temp, 'zip/WEB-INF/demo.txt'), 'demo');
    writeFileSync(join(app, 'dist/version.txt'), '0.1.0');
    const archive = spawnSync('jar', ['--create', '--file', join(app, 'dist/application.war'), '-C', join(temp, 'zip'), '.'], { encoding: 'utf8' });
    assert.equal(archive.status, 0, archive.stderr);
    const lib = join(process.env.GRADLE_TEST_HOME, 'lib');
    const launcher = readdirSync(lib).find(n => /^gradle-launcher-.*\.jar$/.test(n));
    assert.ok(launcher);
    const env = { ...process.env, CI_PROJECT_DIR: app, CI_PIPELINE_SOURCE: 'push', CI_COMMIT_BRANCH: 'develop',
      CI_COMMIT_REF_PROTECTED: 'true', CI_PIPELINE_ID: '234', CI_JOB_ID: '321', CI_PROJECT_ID: '17',
      CI_COMMIT_SHA: 'a'.repeat(40), MAVEN_GROUP_ID: 'com.example', MAVEN_ARTIFACT_ID: 'ci-lab' };
    const args = ['-cp', join(lib, launcher), 'org.gradle.launcher.GradleMain', '--offline', '--no-daemon',
      '-Dorg.gradle.jvmargs=', '-g', join(temp, 'gradle-home'), '-p', tools];
    const good = spawnSync('java', [...args, 'localReleaseTests'], { encoding: 'utf8', env, timeout: 120000 });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /RELEASE_CHECKS_PASSED/);
    const denied = spawnSync('java', [...args, 'createRelease'], { encoding: 'utf8',
      env: { ...env, CI_COMMIT_REF_PROTECTED: 'false' }, timeout: 60000 });
    assert.notEqual(denied.status, 0);
    assert.match(denied.stdout + denied.stderr, /Protected develop push required/);
    const metadata = JSON.parse(readFileSync(join(app, 'dist/release.json'), 'utf8'));
    server = createServer((req, res) => {
      const auth = req.headers.authorization;
      if (auth !== 'Basic ' + Buffer.from('reader:read-secret').toString('base64')) {
        res.writeHead(401); res.end(); return;
      }
      let mode = '';
      try { mode = readFileSync(join(app, 'mode'), 'utf8'); } catch {}
      if (mode === 'redirect') { res.writeHead(302, { Location: '/other' }); res.end(); return; }
      if (req.url.endsWith('-manifest.json')) {
        if (mode === 'oversized') { res.end(' '.repeat(1024 * 1024 + 1)); return; }
        res.end(JSON.stringify(mode === 'project' ? { ...metadata, projectId: '99' } : metadata));
      } else { res.end(mode === 'checksum' ? 'tampered' : readFileSync(join(app, 'dist/application.war'))); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const remoteEnv = { ...env, NEXUS_REPOSITORY_URL: `http://127.0.0.1:${server.address().port}/repository/war-releases`,
      NEXUS_READ_USERNAME: 'reader', NEXUS_READ_PASSWORD: 'read-secret',
      DEPLOY_VERSION: metadata.version, DEPLOY_SHA256: metadata.sha256 };
    const remote = await new Promise((resolve, reject) => {
      const child = spawn('java', [...args, 'localRemoteTests'], { env: remoteEnv, timeout: 60000 });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stderr.on('data', data => { output += data; });
      child.on('error', reject);
      child.on('close', status => resolve({ status, output }));
    });
    assert.equal(remote.status, 0, remote.output);
    assert.match(remote.output, /NEXUS_CHECKS_PASSED/);
    assert.doesNotMatch(remote.output, /read-secret/);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (cleanupError) {
      // Windows can briefly retain Gradle/native-library handles. Do not mask test failures.
      console.warn('Temporary Gradle directory could not be removed:', temp, cleanupError.code);
    }
  }
});
