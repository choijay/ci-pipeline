import org.yaml.snakeyaml.Yaml
import java.nio.charset.StandardCharsets

def root = new File(args[0])
def yaml = new Yaml()
// Preserve GitLab !reference nodes as two-element lists for local expansion.
def read = { String name -> yaml.load(new File(root, name).getText('UTF-8').replace('!reference ', '')) }
def config = read('templates/java-war.yml')
def appFile = new File(root, '../ci-lab/.gitlab-ci.yml')
if (appFile.isFile()) {
    def app = yaml.load(appFile.getText('UTF-8'))
    assert app.include[0].project == app.variables.PIPELINE_PROJECT
    assert app.include[0].ref == app.variables.PIPELINE_REF
    assert app.variables.PIPELINE_REF ==~ /[0-9a-f]{40}/
}
def jobs = [:]
config.include.each { jobs.putAll(read(it.local.substring(1))) }
def ruleMatches = { String expr, Map env ->
    def expression = expr.replaceAll(/\$([A-Z_0-9]+)/) { match, key ->
        groovy.json.JsonOutput.toJson(env[key] ?: '')
    }
    new GroovyShell().evaluate(expression) as boolean
}
def selected = { rules, env ->
    def rule = rules.find { !it.containsKey('if') || ruleMatches(it['if'], env) }
    rule != null && rule.when != 'never'
}
def rulesFor
rulesFor = { name ->
    def job = jobs[name]
    if (job.containsKey('rules')) return job.rules
    def parents = job.extends instanceof List ? job.extends : (job.extends ? [job.extends] : [])
    parents.reverse().collect { rulesFor(it) }.find { it } ?: []
}
def actual = { source, branch, protectedRef, cd, mr ->
    def env = [CI_PIPELINE_SOURCE: source, CI_COMMIT_BRANCH: branch, CI_COMMIT_REF_PROTECTED: protectedRef,
               CD_ENABLED: cd, CI_OPEN_MERGE_REQUESTS: mr]
    if (!selected(config.workflow.rules, env)) return [] as Set
    jobs.keySet().findAll { !it.startsWith('.') && selected(rulesFor(it), env) } as Set
}
assert actual('merge_request_event', '', 'false', 'false', '') == ['branch_policy', 'gitleaks', 'unit_test'] as Set
assert actual('push', 'develop', 'true', 'false', '1') == ['branch_policy', 'gitleaks', 'sonarqube_scan', 'dependency_check', 'unit_test', 'package_war', 'publish_nexus'] as Set
assert actual('push', 'feature/jay-20260914', 'false', 'false', '1').empty
assert actual('push', 'feature/jay-20260914', 'false', 'false', '') == ['branch_policy'] as Set
assert actual('schedule', 'develop', 'true', 'true', '') == ['deploy_development'] as Set
assert actual('web', 'develop', 'true', 'true', '') == ['deploy_development'] as Set
assert actual('schedule', 'develop', 'true', 'false', '').empty
assert actual('web', 'develop', 'false', 'true', '').empty
assert actual('push', 'main', 'true', 'false', '') == ['branch_policy'] as Set
assert config.stages.indexOf('sonar') < config.stages.indexOf('security')
assert config.stages.indexOf('security') < config.stages.indexOf('package')
assert jobs.publish_nexus.dependencies == ['package_war']
def expand
expand = { sequence -> sequence.collectMany { it instanceof List ? expand(jobs[it[0]][it[1]]) : [it] } }
jobs.each { name, job ->
    assert !job.containsKey('needs')
    assert job.allow_failure != true
    ['script', 'before_script'].each { key ->
        if (job[key]) {
            String script = expand(job[key]).join('\n')
            def process = new ProcessBuilder(args[1], '-n').start()
            process.outputStream.withCloseable { it.write(script.getBytes(StandardCharsets.UTF_8)) }
            def error = process.errorStream.getText('UTF-8')
            assert process.waitFor() == 0 : name + ': ' + error
        }
    }
}
def policy = jobs.branch_policy.script.join('\n')
def checkPolicy = { source, target, sourceId, expected ->
    def builder = new ProcessBuilder(args[1], '-s')
    def env = builder.environment()
    env.keySet().findAll { it.startsWith('CI_') }.each { env.remove(it) }
    env.putAll([CI_PIPELINE_SOURCE:'merge_request_event', CI_MERGE_REQUEST_SOURCE_BRANCH_NAME:source,
        CI_MERGE_REQUEST_TARGET_BRANCH_NAME:target, CI_MERGE_REQUEST_SOURCE_PROJECT_ID:sourceId,
        CI_MERGE_REQUEST_PROJECT_ID:'17'])
    def process = builder.start()
    process.outputStream.withCloseable { it.write(('export PATH=/usr/bin:/bin:$PATH\n' + policy).getBytes(StandardCharsets.UTF_8)) }
    def output = process.inputStream.getText('UTF-8') + process.errorStream.getText('UTF-8')
    assert (process.waitFor() == 0) == expected : output
}
checkPolicy('feature/jay-20260914', 'develop', '17', true)
checkPolicy('develop', 'main', '17', true)
checkPolicy('feature/jay-20260914', 'main', '17', false)
checkPolicy('feature/jay-20260914', 'develop', '99', false)
println('Pipeline YAML, workflow, branch policy and shell syntax passed')
