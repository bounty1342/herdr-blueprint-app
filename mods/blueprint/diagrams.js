// Sample diagrams until an agent sends real ones: what it would send, in Mermaid,
// in the person's language. done = finished, active = in progress, current =
// what the agent is on right now.

const WORDS = {
  en: {
    authTab: "Auth flow", authTitle: "Order API auth flow",
    request: "Request", verify: "Verify JWT", expired: "Expired?", yes: "yes", no: "no",
    refresh: "Refresh token", create: "Create order", response: "Response",
    dbTab: "DB schema", dbTitle: "Order domain tables", events: "events",
    shipTab: "Rollout", shipTitle: "Order API rollout",
    merged: "PR merged", build: "CI build", e2e: "Integration tests", passed: "Passed?",
    staging: "Deploy to staging", fix: "Fix", fixBranch: "hotfix branch", canary: "Canary 10%", prod: "Production",
  },
  ko: {
    authTab: "인증 흐름", authTitle: "주문 API 인증 흐름",
    request: "요청", verify: "JWT 검증", expired: "만료?", yes: "예", no: "아니오",
    refresh: "토큰 재발급", create: "주문 생성", response: "응답",
    dbTab: "DB 스키마", dbTitle: "주문 도메인 테이블", events: "이벤트",
    shipTab: "배포 순서", shipTitle: "주문 API 배포 순서",
    merged: "PR 머지", build: "CI 빌드", e2e: "통합 테스트", passed: "통과?",
    staging: "스테이징 배포", fix: "수정", fixBranch: "hotfix 브랜치", canary: "카나리 10%", prod: "프로덕션",
  },
  ja: {
    authTab: "認証フロー", authTitle: "注文APIの認証フロー",
    request: "リクエスト", verify: "JWT検証", expired: "期限切れ?", yes: "はい", no: "いいえ",
    refresh: "トークン再発行", create: "注文作成", response: "レスポンス",
    dbTab: "DBスキーマ", dbTitle: "注文ドメインのテーブル", events: "イベント",
    shipTab: "デプロイ手順", shipTitle: "注文APIのデプロイ手順",
    merged: "PRマージ", build: "CIビルド", e2e: "結合テスト", passed: "成功?",
    staging: "ステージングへデプロイ", fix: "修正", fixBranch: "hotfixブランチ", canary: "カナリア 10%", prod: "本番",
  },
};

export function diagramsFor(lang) {
  const w = WORDS[lang] ?? WORDS.en;
  return [
    {
      tab: w.authTab,
      src: `---
title: ${w.authTitle}
---
flowchart LR
  req(["${w.request}<br/>POST /orders"]) --> jwt["${w.verify}<br/>AuthFilter"] --> exp{"${w.expired}"}
  exp -->|${w.yes}| tok["${w.refresh}<br/>TokenService"]
  exp -->|${w.no}| ord["${w.create}<br/>OrderController"]
  tok --> res(["${w.response}<br/>200 / 401"])
  ord --> db[("orders<br/>PostgreSQL")]
  db --> res
  class req,jwt,exp done
  class tok current
  %% code: req src/routes/orders.ts:12
  %% code: jwt src/auth/AuthFilter.ts:18
  %% code: exp src/auth/AuthFilter.ts:41
  %% code: tok src/auth/TokenService.ts:57
  %% code: ord src/orders/OrderController.ts:23
  %% code: db db/migrations/003_orders.sql:1`,
    },
    {
      tab: w.dbTab,
      src: `---
title: ${w.dbTitle}
---
flowchart LR
  users[("users<br/>id · email")] -->|1:N| orders[("orders<br/>id · user_id · status")]
  orders -->|1:N| items[("order_items<br/>order_id · product_id")]
  products[("products<br/>id · price")] -->|1:N| items
  users -->|1:N| tokens[("refresh_tokens<br/>user_id · expires_at")]
  orders -.->|${w.events}| events[("order_events<br/>order_id · type")]
  class users,orders,products done
  class events active
  class items current
  %% code: users db/migrations/001_users.sql:1
  %% code: orders db/migrations/003_orders.sql:1
  %% code: items db/migrations/004_order_items.sql:1`,
    },
    {
      tab: w.shipTab,
      src: `---
title: ${w.shipTitle}
---
flowchart TB
  pr(["${w.merged}<br/>main"]) --> ci["${w.build}<br/>GitHub Actions"] --> test["${w.e2e}<br/>pnpm test:e2e"]
  test --> ok{"${w.passed}"}
  ok -->|${w.yes}| stg["${w.staging}<br/>k8s/staging"]
  ok -->|${w.no}| fix["${w.fix}<br/>${w.fixBranch}"]
  fix -.-> ci
  stg --> canary["${w.canary}<br/>argo rollouts"] --> prod(["${w.prod}<br/>100%"])
  class pr,ci done
  class test current
  %% code: ci .github/workflows/ci.yml:1
  %% code: test e2e/orders.spec.ts:1`,
    },
  ];
}
