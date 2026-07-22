# 뉴스 검색 프록시 (Cloudflare Worker) 배포 가이드

news.html의 뉴스 검색은 네이버 검색 API를 쓰는데, 정적 사이트(GitHub Pages)에서는
직접 호출이 불가능(CORS 차단 + Secret 노출)하므로 이 Worker가 중계한다.
**네이버 키는 이 저장소가 아니라 Cloudflare에만 저장된다.**

## 1. Worker 생성 (5분, 무료)

1. https://dash.cloudflare.com 로그인 (무료 계정)
2. 좌측 **Workers & Pages** → **Create** → **Create Worker**
3. 이름: `silab-news` (자유) → **Deploy** (기본 hello world로 일단 배포)
4. **Edit code** 클릭 → 기본 코드를 전부 지우고 `news-proxy.js` 내용을 붙여넣기 → **Deploy**

## 2. 네이버 키 등록 (비밀 변수)

1. Worker 상세 화면 → **Settings** → **Variables and Secrets**
2. **Add** 로 아래 2개를 **Secret** 타입으로 추가:
   - `NAVER_CLIENT_ID` = 네이버 개발자센터에서 발급받은 Client ID
   - `NAVER_CLIENT_SECRET` = Client Secret
3. 저장하면 자동 재배포됨

## 3. 홈페이지에 연결

1. Worker 주소 확인: `https://silab-news.<계정명>.workers.dev`
2. `Silab/news.js` 맨 위의 `NEWS_PROXY_URL` 상수에 그 주소를 입력
3. git push → GitHub Pages 배포

## 4. 동작 확인

브라우저에서 직접 열어보기 (Origin이 없으면 403이 정상이므로, news.html에서 검색해 확인):
- silab.ai.kr/news.html 접속 → 검색어 입력 → 결과가 나오면 완료

## 무료 한도 (모두 무료로 충분)

| 항목 | 한도 |
|------|------|
| 네이버 검색 API | 25,000회/일 |
| Cloudflare Workers 무료 플랜 | 100,000회/일 |

같은 검색어는 Worker가 5분간 캐시하므로 실제 네이버 쿼터 소모는 더 적다.

## Firebase 규칙 (키워드 채널용, 선택)

뉴스 페이지의 키워드 채널(자주 쓰는 검색어 칩)을 관리자가 편집하려면
Firebase Realtime Database 규칙에 `news` 노드를 추가:

```json
"news": {
  ".read": true,
  ".write": "auth != null && (auth.uid === 'vXGv4tLnkzUfNbKHMm8c8cGQ4Z03' || auth.uid === '3aEjEgu6XTa5DCBIUxt22wjKrnr2')"
}
```

규칙을 추가하지 않으면 기본 키워드(news.js의 `DEFAULT_KEYWORDS`)가 사용된다.
