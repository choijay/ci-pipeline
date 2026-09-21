#!/usr/bin/env bash
# 관리자 최초 1회 실행: sudo bash ops/install-gitleaks.sh
# Java/Python/Git 설치는 README 명령을 사용합니다.
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo.'; exit 1; }
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || {
  echo 'This installer is for Linux x86_64.'; exit 1;
}
version='8.30.1'
archive="gitleaks_${version}_linux_x64.tar.gz"
base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$base/$archive" -o "$archive"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 "$base/gitleaks_${version}_checksums.txt" -o checksums.txt
awk -v name="$archive" '$2 == name || $2 == "*" name {print}' checksums.txt > selected.sha256
[[ "$(wc -l < selected.sha256)" -eq 1 ]] || { echo 'Checksum entry missing/ambiguous.'; exit 1; }
sha256sum --check selected.sha256
tar -xzf "$archive" gitleaks
install -d -m 0755 "/usr/local/lib/gitleaks/$version"
install -m 0755 gitleaks "/usr/local/lib/gitleaks/$version/gitleaks"
ln -sfn "/usr/local/lib/gitleaks/$version/gitleaks" /usr/local/bin/gitleaks
/usr/local/bin/gitleaks version
