// news-proxy.js — 네이버 뉴스 검색 API 중계용 Cloudflare Worker
//
// silab.ai.kr(GitHub Pages, 정적)은 서버가 없어 네이버 API를 직접 호출할 수 없고
// (CORS 차단 + Client Secret 노출 문제), 이 Worker가 그 백엔드 역할을 대신한다.
//
//   브라우저(news.js) → 이 Worker → openapi.naver.com
//
// 키는 코드에 넣지 않는다. Cloudflare 대시보드에서 비밀 변수 2개를 등록할 것:
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET
// 배포 절차는 같은 폴더의 README.md 참조.

// 호출을 허용할 출처. 'null'은 로컬에서 news.html을 파일로 직접 열어 테스트할 때 필요
// (운영만 남기려면 아래에서 'null'과 localhost 항목을 지우면 된다)
const ALLOWED_ORIGINS = [
    'https://silab.ai.kr',
    'https://www.silab.ai.kr',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'null',
];

const CACHE_TTL = 300;   // 같은 검색어 반복 호출 시 5분간 에지 캐시 (네이버 쿼터 절약)

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowed = ALLOWED_ORIGINS.includes(origin);
        const cors = {
            'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Vary': 'Origin',
        };

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'GET') return json({ error: 'GET 요청만 지원합니다.' }, 405, cors);
        // Origin 검사는 브라우저 외 무단 사용을 줄이는 완충 장치 (완전한 차단은 아님 — 쿼터가 넉넉해 감수)
        if (!allowed) return json({ error: '허용되지 않은 출처입니다.' }, 403, cors);
        if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) {
            return json({ error: 'Worker에 NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 비밀 변수가 설정되지 않았습니다.' }, 500, cors);
        }

        const u = new URL(request.url);
        const query = (u.searchParams.get('query') || '').trim();
        if (!query) return json({ error: 'query 파라미터가 필요합니다.' }, 400, cors);
        // 네이버 API 허용 범위로 강제: display 1~100, start 1~1000
        const display = clamp(parseInt(u.searchParams.get('display'), 10) || 20, 1, 100);
        const start = clamp(parseInt(u.searchParams.get('start'), 10) || 1, 1, 1000);
        const sort = u.searchParams.get('sort') === 'sim' ? 'sim' : 'date';

        // 에지 캐시 확인 (workers.dev 도메인에서는 캐시가 동작하지 않을 수 있음 — 그래도 무해)
        const cacheKey = new Request('https://silab-news-cache.internal/?' +
            new URLSearchParams({ query, display: String(display), start: String(start), sort }));
        const cache = caches.default;
        const hit = await cache.match(cacheKey);
        if (hit) {
            const r = new Response(hit.body, hit);
            for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
            return r;
        }

        const api = 'https://openapi.naver.com/v1/search/news.json' +
            `?query=${encodeURIComponent(query)}&display=${display}&start=${start}&sort=${sort}`;
        const upstream = await fetch(api, {
            headers: {
                'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
            },
        });
        const body = await upstream.text();
        const resp = new Response(body, {
            status: upstream.status,
            headers: {
                ...cors,
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'public, max-age=' + CACHE_TTL,
            },
        });
        if (upstream.ok) await cache.put(cacheKey, resp.clone());
        return resp;
    },
};

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

function json(obj, status, cors) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
    });
}
