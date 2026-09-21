# Counter Demo systemd 배포 패키지

동일 VM의 counter-demo.service를 중지 → WAR 링크 전환 → 시작 → API 확인하는 관리용 패키지입니다.
서비스 정의, 포트 18080, 전용 계정, sudo의 stop/restart/reset-failed 세 명령은 유지합니다.
실패 시 이전 WAR로 복구를 시도하며, 복구 성공이어도 새 배포는 실패로 반환합니다.

## Python 없는 수정본

- deploy-war의 WAR/manifest/API 확인을 DeploymentChecks.java로 교체했습니다.
- install.sh가 기존 JDK 17의 javac/jar로 작은 검증 JAR을 만든 뒤
  /usr/local/lib/ci/counter-deployment-checks.jar에 root 소유로 설치합니다.
- 외부 Java 라이브러리, Python, jq 설치는 필요 없습니다.
- manifest는 기존 release.json의 평평한 필드 구조와 호환됩니다. 중첩 객체/배열, 이스케이프 문자열,
  중복 키 등 이 릴리스 스키마에서 생성하지 않는 구조는 거부합니다.
- API는 현재 앱의 정확한 응답 형태인 {"value":정수}를 두 번 연속 확인합니다.
- reset-failed는 failed 상태에서만 실행하고 실제 오류는 숨기지 않습니다.
- 구형 직접 프로세스 실행 helper가 남아 있으면 서비스 변경 전에 중단합니다.
  현재 최종 구성인 systemd 신규 설치/갱신만 지원합니다.

## 서버 적용 — 사용자 확인 후 별도 실행

전제: Ubuntu x64, /usr/lib/jvm/java-17-openjdk-amd64/bin의 java/javac/jar,
curl, ss, flock, sudo/visudo, systemd, gitlab-runner 계정.
기존 서버에 Python 버전이 설치되어 있으므로 GitLab에 코드를 올리는 것만으로는 교체되지 않습니다.

WinSCP로 이 폴더의 install.sh, deploy-war, DeploymentChecks.java, counter-demo.service,
gitlab-counter-demo.sudoers를 함께 서버에 업로드합니다.

아래는 **Azure/PuTTY Bash용 안내**이며 이번 작업에서는 실행하지 않았습니다.

```bash
cd /home/adolab/counter-systemd-deploy
sudo bash install.sh --migrate
```

이 명령은 실행 중인 counter-demo를 중지하고 자동으로 시작하지 않습니다.
기존 WAR/releases/current는 보존하고 기존 설치 파일과 검증 JAR을
/var/backups/counter-systemd-deploy/에 백업합니다.
JAR 컴파일과 기본 검증은 서비스 중지 전에 수행합니다.
설치 전체가 자동 롤백되는 트랜잭션은 아닙니다.

설치 후 사용자가 CD를 실행하거나 기존 current WAR를 명시적으로 시작해야 합니다.
GitLab/Runner/Nexus/SonarQube 등의 다른 서비스를 재시작하지 않습니다.

## 서버 확인 명령

```bash
sudo systemctl is-enabled counter-demo.service
sudo systemctl status counter-demo.service --no-pager -l
sudo journalctl -u counter-demo.service -n 80 --no-pager
curl --noproxy '*' -fsS http://127.0.0.1:18080/api/counter
```

실제 서버 설치·기동 성공은 이번 로컬 검증에 포함하지 않았습니다.
Python을 운영체제에서 제거하는 명령은 필요하지 않습니다.
테스트 폴더의 Python 파일은 과거 Linux 모의 검증용 개발 도구이며 배포/설치 실행 경로에서는 사용하지 않습니다.
