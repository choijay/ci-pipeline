# VS Code 기준 적용 방법

모든 Git 명령은 사용자가 직접 실행하는 로컬 터미널용입니다. 서버 설치/배포는 별도입니다.

## 이미 두 저장소를 올린 현재 상태

1. VS Code에서 ci-pipeline을 선택하고 변경 목록을 확인합니다. bootstrap 및 Python 실행 파일 삭제와 YAML 변경을 함께 커밋합니다.
2. 아래 명령으로 Push하고 새 SHA를 확인합니다.

```cmd
cd C:\Project\2026.HanwhaOcean\ci-pipeline
git add -A
git diff --cached --stat
git commit -m "Simplify pipeline and replace Python runtime"
git push
git rev-parse HEAD
```

3. ci-lab/.gitlab-ci.yml의 PIPELINE_REF 값을 위에서 출력된 **40자리 SHA**로 바꿉니다.

```yaml
variables:
  PIPELINE_PROJECT: &pipeline_project 'hanwha/ci-pipeline'
  PIPELINE_REF: &pipeline_ref '새커밋SHA'
include:
  - project: *pipeline_project
    ref: *pipeline_ref
    file: '/templates/java-war.yml'
```

4. ci-lab의 연결 설정을 업로드합니다. Gradle 보조 파일은 ci-pipeline/ci/에만 둡니다.

```cmd
cd C:\Project\2026.HanwhaOcean\ci-lab
git status --short --branch
git add -A
git diff --cached --stat
git commit -m "Use simplified shared pipeline"
git push
```

현재 feature 브랜치에서 진행하면 열린 MR에 반영됩니다.
새 파이프라인의 unit_test에는 추가 저장소 다운로드가 없습니다.
dependency_check/package_war/publish_nexus는 ci-pipeline 전체를 clone하고 지정한 SHA를 checkout합니다.
PIPELINE_PROJECT/PIPELINE_REF는 앱 YAML에서만 지정합니다. 기존 GitLab UI/스케줄 변수에 중복 값이 있다면 제거하세요.
PIPELINE_GIT_BASE_URL 기본값은 같은 VM의 http://127.0.0.1입니다.
별도 Runner를 쓰면 Runner에서 접근 가능한 GitLab HTTPS 주소(프로젝트 경로 제외)로 설정하세요.

## GitLab 읽기 권한

앱 파이프라인을 시작하는 사용자와 예약 실행 소유자는 ci-pipeline을 읽을 수 있어야 합니다.
Private 프로젝트 include를 위해 최소 Reporter 권한을 확인하세요(그룹 상속 가능).
ci-pipeline → Settings → CI/CD → Job token permissions → CI/CD job token allowlist에 hanwha/ci-lab을 추가합니다.
include 권한만으로 Job token checkout까지 허용되지는 않습니다. 별도 개인 토큰은 필요하지 않습니다.
Nexus/Sonar 비밀 변수와 CD 입력은 ci-lab에 유지합니다.
GitLab Pipeline editor/CI Lint로 include를 검증한 뒤 실제 파이프라인을 확인합니다.

## 새로 만드는 경우에만

GitLab의 New project → Create blank project에서 namespace hanwha, 이름 ci-pipeline으로 생성합니다.
README 초기화는 해제합니다. Code → Clone에서 실제 URL을 복사합니다.

VS Code에서 ci-pipeline 폴더를 열고 로컬 저장소를 커밋한 다음:

```cmd
git remote add origin "복사한 실제 Clone URL"
git push -u origin main
```

origin이 이미 있으면 중복 추가하지 말고 git remote -v로 확인합니다.
CMD에서는 작은따옴표 대신 **큰따옴표**를 사용합니다.
로컬 저장소 소유자 오류가 발생하면 해당 경로만 신뢰하도록 설정합니다.

```cmd
git config --global --add safe.directory C:/Project/2026.HanwhaOcean/ci-pipeline
```

## 서버의 Python 의존성 제거

서버에 이미 설치된 deploy-war는 Git Push만으로 바뀌지 않습니다.
ops/counter-systemd-deploy/README.md의 갱신 절차를 확인하세요.
새 패키지는 JDK 17로 검증 JAR을 컴파일하고 설치합니다. JDK는 기존 앱 실행/빌드와 같습니다.
installer는 앱을 중지하므로 적용 시점은 별도로 정해야 합니다. 이번 로컬 작업에서 서버 명령은 실행하지 않았습니다.

공식 문서:
- [외부 프로젝트 include](https://docs.gitlab.com/ci/yaml/#includeproject)
- [Job token과 저장소 clone 권한](https://docs.gitlab.com/ci/jobs/ci_job_token/)
- [GitLab 프로젝트 생성](https://docs.gitlab.com/user/project/)
