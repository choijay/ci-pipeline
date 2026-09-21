# ci-pipeline

앱 파이프라인에서 include하는 YAML과 서버 설치 패키지를 관리합니다.

| 저장소 | 내용 |
|---|---|
| ci-pipeline | .gitlab/*.yml, templates/java-war.yml, ci/의 Gradle 보조 스크립트, ops/ |
| ci-lab | 앱 소스, Gradle Wrapper, 연결용 .gitlab-ci.yml |

- Gradle 보조 파일이 필요한 3개 Job만 공통 저장소 전체를 clone하고 include와 같은 SHA로 checkout합니다.
- unit_test와 Sonar는 공통 저장소 checkout 없이 실행합니다. 별도 bootstrap 단계는 없습니다.
- 릴리스/체크섬/Nexus 다운로드 코드는 **.gitlab/release.yml 안**에 있습니다.
- YAML은 작은 임시 Gradle 프로젝트(.ci-release)를 만들어 기존 Wrapper로 실행합니다. 별도 런타임 설치나 앱 재빌드는 없습니다.
- .gitlab/cd.yml에 다운로드·검증 → 설치된 adapter 호출 순서를 직접 작성했습니다.
- ci/에는 Dependency-Check 설정, WAR 내보내기, Maven 게시용 Gradle 파일을 별도 파일로 유지합니다.
- DC/Sonar develop Push 전용, stage 순서, 보호 브랜치, 수동/예약 CD, 검증 실패 차단은 유지합니다.
- Python은 파이프라인·서버 설치·배포 실행 경로에서 사용하지 않습니다. jq도 필요 없습니다.

## 변경 적용

1. ci-pipeline 변경을 커밋·Push하고 git rev-parse HEAD로 SHA를 확인합니다.
2. ci-lab/.gitlab-ci.yml의 PIPELINE_REF를 그 SHA로 바꾸고 커밋·Push합니다. YAML anchor로 include.ref도 함께 바뀝니다.
3. 새 앱 파이프라인으로 확인합니다. 기존 Job Retry는 과거 YAML을 사용합니다.

ci-pipeline의 CI/CD Job token permissions allowlist에 ci-lab을 등록해야 checkout할 수 있습니다.
GitLab include 및 checkout을 실행하는 사용자의 프로젝트 읽기 권한도 필요합니다.
PIPELINE_PROJECT/PIPELINE_REF는 앱 YAML에서 관리하며 GitLab UI 변수로 중복 설정하지 마세요.
PIPELINE_GIT_BASE_URL 기본값은 같은 VM의 http://127.0.0.1입니다. 다른 Runner라면 접근 가능한 HTTPS 주소로 변경하세요.
현재 앱 ref는 사용 중인 기존 값입니다. 수정본을 Push한 후 갱신하세요.

서버에는 이전 Python adapter가 설치되어 있을 수 있습니다. Python 없는 CD를 사용하려면
ops/counter-systemd-deploy 패키지를 승인된 시점에 갱신해야 합니다.
installer는 앱을 중지하므로 로컬 코드 변경과 서버 적용을 구분하세요.
운영체제의 Python을 삭제하라는 뜻은 아닙니다.

자세한 순서: [VS Code 안내](docs/VSCODE-GITLAB-SETUP.md)

## 로컬 테스트

JDK 17과 Node.js, Git Bash를 사용합니다.

```powershell
$env:JAVA_HOME = 'C:\DEV\Java\jdk-17.0.9'
$env:PATH = "$env:JAVA_HOME\bin;C:\Program Files\Git\bin;" + $env:PATH
node --test tests/simplified.test.mjs tests/deployment-checks.test.mjs ops/counter-systemd-deploy/tests/reset-failed.test.mjs
node --test tests/checkout.test.mjs
```

릴리스 테스트는 GRADLE_TEST_HOME을 이미 다운로드된 Gradle 8.14.5 배포본 폴더로 설정하고
node --test tests/release-gradle.test.mjs를 실행합니다. 실제 Nexus 대신 임시 로컬 HTTP 서버를 사용합니다.
tests/pipeline.groovy는 기존 Gradle의 Groovy와 SnakeYAML 테스트 classpath로 YAML·정책·Shell 문법을 검사합니다.
GRADLE_TEST_HOME은 Gradle 배포본, SNAKEYAML_TEST_JAR는 로컬 캐시에 있는 SnakeYAML JAR 경로로 지정합니다.

```powershell
java -cp "$env:GRADLE_TEST_HOME/lib/*;$env:SNAKEYAML_TEST_JAR" groovy.ui.GroovyMain tests/pipeline.groovy . "C:/Program Files/Git/bin/bash.exe"
```

이 테스트용 JAR은 CI 실행이나 서버 설치에 필요하지 않습니다.
