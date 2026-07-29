# SILAB 홈페이지 유지보수 가이드

## 프로젝트 개요

가천대학교 스마트보안학과 **보안 지능 연구실(SILAB)** 공식 홈페이지.
- 도메인: `silab.ai.kr`
- 배포: GitHub Pages (CNAME 설정됨)
- 관리자 이메일: `kinjecs0@gmail.com`

---

## 기술 스택

| 항목 | 내용 |
|------|------|
| 프론트엔드 | 순수 HTML / CSS / JavaScript (프레임워크 없음) |
| 인증 | Firebase Authentication (이메일/비밀번호) |
| 데이터베이스 | Firebase Realtime Database |
| 이미지 저장 | Cloudinary (`dtgwtdf3q` / preset: `jfwl9ton`) |
| 아이콘 | Font Awesome 6.0.0-beta3 (CDN) |
| Firebase SDK | v8.10.1 (CDN, compat 방식) |

---

## 파일 구조

**2026-07 개편: 페이지별 폴더 구조.** 각 페이지는 자기 폴더 안에 `.html/.css/.js`를 둔다(예: `members/members.html`). **홈(index)·공유파일·CNAME은 root 유지.** 페이지 URL은 `silab.ai.kr/members/members.html` 형태다(기존 평면 `members.html`에서 변경됨 → 옛 외부 링크·북마크는 깨질 수 있음).

⚠**모든 경로는 root 절대경로**(`/members/members.html`, `/common.css`)로 작성한다. 상대경로(`./x.html`)를 쓰면 폴더 깊이 때문에 깨진다. 새 페이지 추가 시에도 nav·자산·교차CSS를 전부 `/폴더/파일` 형태로.

```
Silab/
├── index.html / index.css / index.js       # 홈 (root 필수 — Pages 진입점)
├── common.css / common.js / config.js       # 전 페이지 공유 (root, /common.css 로 참조)
├── image.png                                # 연구실 로고 (root, /image.png)
├── CNAME                                    # GitHub Pages 도메인 설정 (root 필수)
├── members/    (members.html/.css/.js)      # 연구원 소개 (파트타임 카드는 사진·연구분야 생략)
├── research/   · projects/ · project/       # 연구/프로젝트 목록·상세(project-editor.js 포함)
├── Publication/ · photo/ · news/            # 논문 / 활동사진 / 뉴스검색
├── budget/ · payroll/ · activity/           # 예산 / 학생인건비 / 연구활동비
├── performance/ · member-performance/ · team-performance/   # 실적
├── worklog/    (worklog·worklog-eval)       # 업무보드 + 개인별 평가
├── labnote/    (SILab 업무관리 허브)         # 트리 메뉴·텍스트창·캘린더·임베드
├── index_preview/ · batch_upload/           # 홈 미리보기 / 일괄 업로드 도구
└── worker/     (news-proxy.js + README)     # Cloudflare Worker 프록시 (네이버 키 보관)
```

- **nav 활성화**(common.js)는 URL의 **파일명**으로 판정(`pathname.split('/').pop()`)하므로 폴더 구조에서도 동작. navAlias 키도 파일명 기준.
- **labnote 내부 링크**: 기본값은 새 절대경로. 예전에 저장된 짧은 링크(`budget.html` 등)는 `LN_PAGE_MOVES` 매핑(`resolveLink()`)으로 자동 변환.

---

## 페이지별 역할

- **index**: 메인 이미지 슬라이더 + 주요 연구분야 카드
- **members**: 교수/학생 프로필 (사진, 소속, 연구분야)
- **research**: 연구 주제 상세 설명
- **projects**: 연구과제/프로젝트 목록 (연도별)
- **Publication**: 논문 목록 (SCI/KCI 등 구분)
- **photo**: 워크숍, 학회 등 활동 사진 갤러리
- **news** (보안 뉴스 검색): **공개 페이지(로그인 불필요)** — nav의 News 링크도 전 페이지에서 항상 노출, '키워드 채널 편집' 관리자 패널만 로그인(관리자 UID 2계정) 시 표시. 네이버 뉴스 검색 API 기반 뉴스 검색. 결과는 **3단 고정 카드 그리드**(≤1024px 2단, ≤768px 1단, 24건씩), 요약은 5줄 클램프. ⚠제목이 '...'로 잘리는 건 네이버 API 자체 절단이라 프론트에서 못 늘림(카드 CSS엔 제목 줄수 제한 없음). 기본 키워드는 연구주제 정렬(LLM 보안·AI 에이전트 보안·프롬프트 인젝션·AI 레드팀·보안관제·엔드포인트 보안·위협 인텔리전스·APT 공격·침해사고). GitHub Pages는 정적이라 네이버 API 직접 호출 불가(CORS + Secret 노출) → **Cloudflare Worker(`worker/news-proxy.js`)가 중계**하고 네이버 키는 Worker 비밀 변수에만 저장(저장소에 키 없음). `news.js` 상단 `NEWS_PROXY_URL`에 Worker 주소 입력 필요(배포 절차는 `worker/README.md`). 검색창+정렬(최신/정확도)+더보기 페이지네이션, 키워드 채널 칩은 `news/keywords`(Firebase)에서 로드(규칙 미설정 시 `DEFAULT_KEYWORDS` 사용), 관리자 로그인 시 '키워드 채널 편집' 가능 — DB 규칙에 `news` 노드 read true / write 관리자 허용 필요. API 응답의 `<b>` 강조는 template 기반 `sanitizeApiHtml()`로 XSS 없이 유지. 무료 한도: 네이버 25,000회/일, Worker 100,000회/일(같은 검색어 5분 에지 캐시).
- **labnote** (Lab 노트): (로그인 전용) 교수님 초안(`test.html`)의 트리 메뉴 + 자유 텍스트창 양식을 준용한 **원포인트 업무 허브**. 회의/논의 내용을 서식 유지 텍스트창에 편하게 기재하고 추후 이어서 논의. 좌측 3단 트리(메뉴 group > 서브탭 item > 세부 sub, 각 단계 모두 본문 보유) + 우측 contenteditable 편집창(B/U/S·글자색·배경색·글자크기·서식지우기 + 📅오늘 날짜 머리글은 **맨 위**에 삽입=주간보고 '최근 날짜가 위로' 규칙 + 편집창 전용 A±글자크기 localStorage `ln_edfs`). **맞춤법 검사 끔**(spellcheck=false). 메뉴/서브탭/세부는 ＋추가·⋯팝업(이름변경/링크지정/삭제)·드래그로 순서변경·다른 부모로 이동. 서브탭·세부에 **링크 지정** 가능(외부 URL 새 탭 / 내부 페이지 예: `budget.html` 현재 탭) → 트리 라벨 클릭 시 바로 이동, 본문엔 '열기' 카드. 기본 메뉴 8종(Lab 세미나/주간보고/연구논의/수시업무, 논문·특허 관리[논문 제출처 링크], Projects, 실적평가[개인별 평가→worklog-eval·개인별 실적 전반→member-performance 링크], 기타관리[운영정책·구성원→members·예산관리→budget·주소록])은 `labnote` 노드가 비었을 때만 자동 생성(`LN_DEFAULT_GROUPS`), 이후 자유 편집. 메뉴 하단 고정: **Lab 캘린더**(월간 뷰, 날짜칸 클릭→휴가/출장/세미나/기타 일정 추가, 일정 클릭→수정/삭제, `data.calendar` 배열) + **Drive**(구글 드라이브 링크 새 탭). 저장(2026-07 동시편집 개편): **본문 내용은 노드 id별 경로 `labnote/bodies/{id}`에 개별 저장**(그룹/서브탭 `body`, 세부 `text`) — 여러 명이 서로 다른 서브탭을 편집해도 다른 경로에 기록되어 덮어쓰기 없음. **트리 뼈대(이름·순서·색·링크·잠금)는 본문을 뺀 `labnote/groups`**(skeleton), 캘린더는 `labnote/calendar`. 편집 종류별로 예약 후 0.8초 디바운스 `flushSave()`로 경로별 `update`. 인메모리 `data`는 여전히 배열 구조(로드 시 `mergeBodies`로 bodies를 노드에 병합, 저장 시 `skeleton()`으로 본문 분리). **우측 편집창 제목줄의 [저장] 버튼**은 현재 노드 본문만 즉시 저장(`lnSaveOne`), 상단 [저장]은 예약분 즉시 flush. **최초 1회 마이그레이션**(`migrateBodies`, `labnote/bodiesMigrated` 플래그): 트리 안에 있던 구버전 본문을 bodies 경로로 안전 복사(손실 없음, 구버전 데이터는 로드 시 폴백으로도 읽힘). JSON 내보내기/불러오기(초안 `test.json`의 `{knowledge:{groups}}` 형식 호환, 불러오기는 `saveEverything`로 전체 교체). ⚠**DB 규칙 필요**: `labnote` 노드(및 그 하위 `bodies`) read/write를 ADMIN_UID+ROOT_UID에 허용해야 저장/로드됨 — 규칙을 `labnote` 부모에 걸었으면 하위 `bodies`는 자동 상속(추가 작업 불필요), 자식 단위로 걸었으면 `labnote/bodies` 규칙을 별도 추가. 메뉴는 `.nav-perf`로 로그인 시에만 노출(업무관리 드롭다운 첫 항목).
- **labnote 2026-07 개편**: 페이지명 **"SILab 업무관리"**(파일명은 labnote.* 유지, nav/H1/title 변경) — 랩 업무 단일 기준. 메뉴 점 대신 **번호**(1/1-1/1-1-1, 드래그 시 자동). **모든 링크 항목은 클릭 시 우측 본문에 iframe 임베드가 기본**(`openNew:true`만 새 창 이동, ⋯메뉴로 전환). 구버전 `embed` 플래그는 normalize에서 제거. 외부 구글시트는 X-Frame-Options로 막힐 수 있어 '새 탭' 폴백. 캘린더 **시작~종료일**(여러날)+색상(휴가 노랑/출장 연두/세미나 파랑/기타 검정). 폭 1680px·툴바 한 줄·첫 로드 시 첫 메뉴 자동선택. **권한(UI 레벨)**: 그룹 `ownerOnly`(Lab 세미나·연구논의·실적평가) → `ROOT_UID`만 편집, 그 외 계정 보기 전용(⋯/드래그/툴바 숨김). 소유자는 ⋯로 잠금 토글. UI 레벨이라 서버 강제는 아님.
- **nav 구조**: 로그인 전용 메뉴는 **업무관리 드롭다운 하나**(`.nav-drop.nav-perf`, common.css)로 통합 — 하위에 SILab 업무관리(labnote)/업무보드(worklog)/개인별 평가(worklog-eval)/Performance(performance)/예산관리(budget) 5개. 데스크톱은 hover로 펼침, 모바일(≤768px)은 항상 펼침. 하위 페이지 활성 시 부모 버튼도 active(common.js). 별칭: member-/team-performance→performance, payroll·activity→budget.
- **performance**: (로그인 전용) 과제별 연차 실적 요구사항(목표) 입력 + 실적 등록 → 달성/목표 자동 집계 대시보드. 로그아웃 시 내용 비공개, 메뉴(`.nav-perf`)도 숨김. DB 경로: `performance/{과제}/{meta, rows, achievements}`, 논문/특허 트래커는 `performance/__track__/{papers, patents, meta}`
- **member-performance** (멤버 실적): (로그인 전용, 읽기 전용) 현재 구성원(`members/{phd,ms,bs}`, 파트타임·졸업생·교수 제외)별로 논문·특허·수상을 종합 집계. **별도 입력 없이** 기존 DB를 재집계:
    - 논문/수상: `publications/{sci,kci,other}` — `sci`→SCI, `kci`→KCI, `other`→Conference(저널명 한글 포함 시 국내, 아니면 국외). 논문 `award` 필드가 있으면 수상 1건. 저자 귀속은 **정확 일치만** 인정(부분일치 제외): 한글은 이름 완전일치, 영문/이니셜은 멤버 별칭과 정규화 후 완전일치. `authors` 첫 항목이면 1저자.
    - 저자 표기(별칭): `memberPerfAliases/{memberKey}` = "Lee Seon Woo; S.W. Lee; L.S.W" 형식 문자열. **DB 규칙에 관리자 read/write 허용 필요**(최상위 노드는 기본 read 거부). 페이지 상단 '저자 표기 관리' 버튼으로 편집. SCI 등 영문 저자 논문은 여기에 영문 표기를 등록해야 멤버에 집계됨. 미매칭 논문은 '미배정' 섹션에 표시.
    - 특허: `performance/__track__/patents` — label 발명자 토큰을 구성원 이름과 매칭(미매칭은 '미배정' 표시).
    - 실적 점수 = Σ(항목 가중치 × 저자 가중치). 항목: SCI 3.0 / KCI 1.5 / 국제컨퍼 1.5 / 국내컨퍼 1.0 / 특허등록 2.0 / 특허출원 1.0 / 수상 1.0. 저자: 1저자 1.0 / 공저 0.3. 가중치는 `member-performance.js`의 `W`, `AW` 상수에서 수정.
    - 메뉴는 `.nav-perf` 클래스로 로그인 시에만 노출.
- **worklog** (업무관리): (로그인 전용) 교수님 초안(silab-업무관리_1.html) 양식을 준용한 체크리스트 보드. 카테고리 카드(Lab회의/세미나/수시업무/프로젝트/논문·특허, 추가·삭제 가능) 안에 항목(체크박스 + 진척율 링 + 집중 별표)을 두고, 항목 클릭 시 **하위 체크리스트 + 자유 메모** 펼침. 담당자는 미리 등록한 명단(`worklog/people`, 상단 '담당자 명단' 버튼 또는 멤버 페이지에서 불러오기)에서 **클릭으로 지정**(복수 가능, 이름마다 개별 칩으로 자동 줄바꿈). 이름 수정(항목/세부/카테고리)은 prompt 대신 **인라인 입력칸 + [저장]/[취소]**(Enter/Esc). 카테고리 **접기 시 미완료 항목만 한 줄씩 요약**(★/담당자/진척율, 클릭하면 펼침). **진척율은 세부 항목이 있으면 완료 비율로 자동 계산**(`itemPct()`, 수동 조절은 세부 항목 없을 때만). 세부영역은 **보기 모드**(체크만 가능, 메모는 회색 박스 텍스트) / **편집 모드**(✏️ 편집 버튼 → 세부 추가칸·삭제·메모 입력칸 노출)로 분리. **드래그 앤 드롭**으로 항목 순서 변경·카테고리 간 이동·카테고리 카드 순서 변경 가능(행 왼쪽 ⠿ 핸들, 터치 미지원). 변경은 0.8초 디바운스 자동 저장 + 상단 [저장] 버튼으로 즉시 저장. JSON 내보내기/불러오기 지원(교수님 초안 데이터 파일 형식 호환). **담당자 필터 바**: 링크 바 아래 이름 칩(명단 기반) 클릭 시 그 사람 담당 항목만 표시('모두' 담당 포함, 다시 클릭 시 해제, 필터 중엔 빈 카테고리·항목추가줄 숨김, 화면 상태라 저장 안 함). **팀장**: 팀별 1명씩 = **여러 명 지정 가능**(`worklog/leaders` 배열, 구버전 단일 `worklog/leader`는 normalize에서 자동 이관 후 null로 제거) — 담당자 명단 모달 하단에서 이름 클릭으로 지정/해제(복수). 필터 바·담당자 칩·지정 팝업·접힘 요약에서 이름 앞 작은 fa-user-tie 아이콘(`LEADER_IC`)으로만 구분(칩 색은 다른 이름과 동일 — 금색 칩은 부담스럽다고 반려됨), 명단에서 이름이 빠지면 normalize에서 자동 해제, worklog-eval 카드에도 '팀장' 배지 표시(읽기만, leaders+구버전 leader 둘 다 읽음). **팀장 우선 정렬**(`ownerSort()`: '모두'→팀장→나머지, 표시용 — 저장 데이터 순서는 안 바꿈): 지정 팝업 칩 목록·항목 담당자 칩·접힘 요약에 적용(필터 바는 명단 순서 그대로). **담당자 지정 시 팀장 1명 이상 필수**: 팀장이 지정돼 있으면, 담당자 [확인] 시 팀장이 한 명도 없으면 경고 후 확인 차단(팝업 유지, 예외: 담당자를 전부 비우거나 '모두' 지정 시) — 기존 항목을 소급 수정하지는 않음. **마감일(D-Day)**: 항목별 `due`(YYYY-MM-DD), 📅 버튼/배지 클릭 → 날짜 팝오버(오늘/내일/+1주/지우기), 배지는 3일 이내 주황·지남 빨강, 접힌 요약에도 표시. ⚠**저장은 `set()`이 아니라 `update()`**: `worklog/personEvals`(인원별 평가 데이터)를 덮어쓰지 않기 위함 — normalize에서도 `data.personEvals` 삭제 (재발 금지). **읽기도 루트 통째가 아니라 자식별**(sections/people/links/linksInit 개별 once) — RTDB는 부모 read 권한이 자식에 상속되므로, personEvals만 Root 전용으로 잠그려면 `worklog` 노드에 read를 주면 안 되고 자식 단위로 규칙을 걸어야 함. **권장 DB 규칙**: `worklog/personEvals`는 ROOT_UID만, `worklog/$other`는 ADMIN_UID+ROOT_UID read/write. 메뉴는 `.nav-perf`로 로그인 시에만 노출. ⚠디자인은 교수님 선호로 초안풍(인디고/산세리프) 유지 — 명조·서류철 탭 등 화려한 개편은 반려됨.
- **worklog-eval** (개인별 평가): **열람은 관리자 모두(EV_VIEW=ADMIN+ROOT), 기록/삭제는 Root(EV_EDIT=ROOT_UID)만** — 일반 관리자(kinjecs0)는 **읽기 전용**(`canEdit=false`: ＋기록/삭제 버튼·저장상태 숨김, 힌트에 '읽기 전용' 안내). ⚠일반 관리자가 실제로 읽으려면 DB 규칙에서 `worklog/personEvals`의 read를 ADMIN_UID에도 허용해야 함(write는 ROOT만). 업무 보드의 서브탭은 관리자 모두 노출(`#evalTab`, worklog.js updateAuthUI). 업무관리의 자매 페이지 — 두 페이지 상단 **서브탭**([업무 보드]↔[개인별 평가])으로 이동, nav는 업무관리가 active 유지. 담당자 명단(`worklog/people`, 여기서는 읽기만) 인원마다 카드가 생기고, [＋ 기록]을 눌러야 👍잘함/👎보완 토글+이유 입력칸 표시(기록/Esc 시 닫힘 — 평소엔 로그만 보여 깔끔). 기록은 `worklog/personEvals` 배열({id, name, kind: good|bad, text, date}, 날짜 자동 기입)에만 `set()` 저장(0.8초 디바운스), 최신이 위, 삭제는 confirm. 명단에서 빠졌지만 기록이 남은 이름은 '명단 외' 배지로 계속 표시(기록 유실 방지). 스타일은 worklog.css 공유(.eval-card, .eval-item 등).

---

## 관리자 기능

로그인 후 각 페이지에 **관리자 패널**이 표시되며, Firebase DB를 통해 콘텐츠를 CRUD한다.
- 인증: Firebase Auth 이메일 로그인, `ALLOWED_EMAIL` 상수로 단일 계정 제한
- 이미지 업로드: Cloudinary unsigned upload (직접 브라우저 → Cloudinary)
- 데이터 저장: Firebase Realtime Database (JSON 트리 구조)

---

## 수정 시 주의사항

### 공통
- `common.css`는 모든 페이지에서 공유하므로 변경 시 전체 페이지 영향 확인
- Firebase 설정값(apiKey 등)은 `index.js` 최상단에 있으며, 모든 `.js` 파일에 동일하게 존재
- Firebase SDK는 v8 compat 방식 사용 — `firebase.database()`, `firebase.auth()` 형태 유지

### 콘텐츠 추가/수정 절차
1. 브라우저에서 `kinjecs0@gmail.com`으로 로그인
2. 해당 페이지의 관리자 패널 사용 (직접 HTML 수정 불필요)
3. 이미지는 Cloudinary에 자동 업로드됨

### 코드 수정
- 각 페이지는 `(페이지명).html + (페이지명).css + (페이지명).js` 세트로 독립 구성
- JS 파일 상단의 `firebaseConfig`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_UPLOAD_PRESET`, `ALLOWED_EMAIL` 상수는 모든 파일에서 동일한 값 유지

---

## 배포

```bash
git add .
git commit -m "변경 내용 설명"
git push origin main   # GitHub Pages 자동 배포
```

배포 후 `silab.ai.kr`에서 반영 확인 (보통 수 분 이내).

---

## 자주 하는 작업

| 작업 | 방법 |
|------|------|
| 멤버 추가/수정 | 브라우저 로그인 → Members 페이지 관리자 패널 |
| 논문 추가 | 브라우저 로그인 → Publications 페이지 관리자 패널 |
| 홈 슬라이드 이미지 추가 | 브라우저 로그인 → Home 관리자 패널 → 슬라이드 추가 |
| 연구분야 카드 수정 | 브라우저 로그인 → Home 관리자 패널 → 연구카드 수정 |
| 새 페이지 추가 | `(페이지명).html/.css/.js` 생성 + `common.css` 포함 + 모든 페이지 nav에 링크 추가. ⚠`.login-modal`(display:none)·`.admin-panel`·`.submit-btn/.cancel-btn` 스타일은 common.css에 없고 **각 페이지 css마다 복사돼 있음** — 새 페이지 css에 안 넣으면 로그인 폼이 페이지 상단에 그대로 노출됨(news.css 하단 블록 참고) |
| Firebase 규칙 변경 | Firebase Console → Realtime Database → Rules |
