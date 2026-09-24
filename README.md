# SUPER GONGIK

모바일 우선, 게스트 우선의 사회복무요원 복무 관리 PWA입니다. 복무일·진행률·연가·보수 정보를 보여 주되, 확인되지 않은 정책값을 자동 계산하지 않는 것을 기본 원칙으로 삼습니다.

## Workspace

```text
apps/web             Next.js App Router PWA (화면, 파일 파서, localStorage 어댑터)
packages/domain      날짜·복무 프로필·복무 기록(ServiceEvent)·연가 원장·저장소 계약·백업
packages/rules       시행일별 정책 번들, 연가 부여 도출, 보수 계산 안전 게이트
packages/importer    기관 복무기록 파일을 canonical 기록 초안으로 정규화
supabase             선택형 클라우드 동기화 마이그레이션(RLS 포함)과 SQL 테스트
```

## 지금 되는 것

- 게스트 프로필, D-Day, 진행률 (Asia/Seoul 달력 날짜 기준)
- 복무 캘린더: 월간·목록 보기, 기록 추가/수정/삭제/되돌리기, 겹치는 휴가 차단
- 휴가 원장: 캘린더 기록에서만 사용량을 계산, 부여일 기준 규칙 선택, 반가는 반일 단위, 시간 단위는 분, 기관 잔액과 비교·보정
- 기관 파일 가져오기: CSV/TSV/XLSX/HWP/HWPX/텍스트 PDF/동의 후 OCR, 중복 방지, 일괄 취소
- 보수: 검증된 기본 보수만 계산, 중식비는 제안값, 교통비는 통근 조건 필요, 합계는 계산하지 않음
- 백업: 전체 JSON 백업, 복무기록·연가 원장 CSV, 검증 후 합치기/덮어쓰기 복원, 기기 데이터 전체 삭제
- 저장: 버전이 있는 단일 문서, 이전 버전 자동 이전, 손상 시 원본 격리·직전본 복구
- 선택형 클라우드 동기화(Supabase 설정 시): 이메일 코드 로그인, 여러 기기 동기화, 충돌은 직접 선택, 클라우드 백업, 클라우드 데이터 삭제. 로그인하지 않으면 네트워크를 쓰지 않아요. [docs/CLOUD_SYNC.md](docs/CLOUD_SYNC.md)

구조 결정은 [docs/adr/0001-portable-core-and-local-persistence.md](docs/adr/0001-portable-core-and-local-persistence.md), 진행 상황은 [docs/ROADMAP.md](docs/ROADMAP.md)를 보세요.

```bash
pnpm install
pnpm dev
pnpm check
```

`pnpm check`는 lint, formatting, typecheck, unit test, production build를 순서대로 실행합니다.

## 안전한 계산 원칙

- 날짜는 `Asia/Seoul`의 달력 날짜로 계산합니다.
- 21개월 일반 연가는 15일 + 13일, 총 28일입니다.
- 정책은 이벤트/지급 대상 날짜로 버전을 선택하며, 과거 정책을 최신 값으로 대체하지 않습니다.
- 2026년 중식비 9,000원은 제안값이며 프로필 확인 전에는 확정 보수에 포함하지 않습니다.
- 교통비는 통근비 또는 기관 승인 금액의 맥락이 없으면 계산을 거부합니다.
- 부분월 보수와 이전 복무 경력 인정은 검증된 규칙표가 추가되기 전까지 자동 계산하지 않습니다. 이전 복무 경력 여부를 답하지 않으면 기본 보수도 계산하지 않습니다.
- 소집일이 검증된 연가 규칙(2026-04-23~)보다 이전이면 1년차 연가를 자동으로 넣지 않고 기관 부여 일수 확인을 요청합니다.
- 반가를 240분으로, 1일을 480분으로 가정하지 않습니다. 1일 근무시간은 사용자가 설정해야 일수와 분을 합칩니다.
- 외출·지각·조퇴를 연가에서 자동 차감하지 않습니다 (차감 기준 미검증).

자세한 정책 출처와 미해결 검증 항목은 [docs](docs/) 및 [packages/rules/README.md](packages/rules/README.md)를 확인하세요.
