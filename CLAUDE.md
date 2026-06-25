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

```
Silab/
├── index.html / index.css / index.js       # 홈 (슬라이더, 연구분야 카드)
├── members.html / members.css / members.js  # 연구원 소개
├── research.html / research.css / research.js # 연구 소개
├── projects.html / projects.css / projects.js # 프로젝트 목록
├── Publication.html / Publication.css / Publication.js # 논문 목록
├── photo.html / photo.css / photo.js       # 기타 활동 사진
├── common.css                               # 공통 스타일 (헤더, 푸터, 모달 등)
├── styles.css                               # 전역 기본 스타일
├── batch_upload.html                        # 관리자용 일괄 업로드 도구
├── image.png                                # 연구실 로고
└── CNAME                                    # GitHub Pages 도메인 설정
```

---

## 페이지별 역할

- **index**: 메인 이미지 슬라이더 + 주요 연구분야 카드
- **members**: 교수/학생 프로필 (사진, 소속, 연구분야)
- **research**: 연구 주제 상세 설명
- **projects**: 연구과제/프로젝트 목록 (연도별)
- **Publication**: 논문 목록 (SCI/KCI 등 구분)
- **photo**: 워크숍, 학회 등 활동 사진 갤러리
- **performance**: (로그인 전용) 과제별 연차 실적 요구사항(목표) 입력 + 실적 등록 → 달성/목표 자동 집계 대시보드. 로그아웃 시 내용 비공개, 메뉴(`.nav-perf`)도 숨김. DB 경로: `performance/{과제}/{meta, rows, achievements}`, 논문/특허 트래커는 `performance/__track__/{papers, patents, meta}`
- **member-performance** (멤버 실적): (로그인 전용, 읽기 전용) 현재 구성원(`members/{phd,ms,bs}`, 파트타임·졸업생·교수 제외)별로 논문·특허·수상을 종합 집계. **별도 입력 없이** 기존 DB를 재집계:
    - 논문/수상: `publications/{sci,kci,other}` — `sci`→SCI, `kci`→KCI, `other`→Conference(저널명 한글 포함 시 국내, 아니면 국외). 논문 `award` 필드가 있으면 수상 1건. 저자 귀속은 **정확 일치만** 인정(부분일치 제외): 한글은 이름 완전일치, 영문/이니셜은 멤버 별칭과 정규화 후 완전일치. `authors` 첫 항목이면 1저자.
    - 저자 표기(별칭): `memberPerfAliases/{memberKey}` = "Lee Seon Woo; S.W. Lee; L.S.W" 형식 문자열. **DB 규칙에 관리자 read/write 허용 필요**(최상위 노드는 기본 read 거부). 페이지 상단 '저자 표기 관리' 버튼으로 편집. SCI 등 영문 저자 논문은 여기에 영문 표기를 등록해야 멤버에 집계됨. 미매칭 논문은 '미배정' 섹션에 표시.
    - 특허: `performance/__track__/patents` — label 발명자 토큰을 구성원 이름과 매칭(미매칭은 '미배정' 표시).
    - 실적 점수 = Σ(항목 가중치 × 저자 가중치). 항목: SCI 3.0 / KCI 1.5 / 국제컨퍼 1.5 / 국내컨퍼 1.0 / 특허등록 2.0 / 특허출원 1.0 / 수상 1.0. 저자: 1저자 1.0 / 공저 0.3. 가중치는 `member-performance.js`의 `W`, `AW` 상수에서 수정.
    - 메뉴는 `.nav-perf` 클래스로 로그인 시에만 노출.

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
| 새 페이지 추가 | `(페이지명).html/.css/.js` 생성 + `common.css` 포함 + 모든 페이지 nav에 링크 추가 |
| Firebase 규칙 변경 | Firebase Console → Realtime Database → Rules |
