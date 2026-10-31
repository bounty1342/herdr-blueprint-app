// Sample diagrams until an agent sends real ones: what it would send, in Mermaid.
// done = finished, active = in progress, current = what the agent is on right now.

export const DIAGRAMS = [
  {
    tab: "인증 흐름",
    src: `---
title: 주문 API 인증 흐름
---
flowchart LR
  req(["요청<br/>POST /orders"]) --> jwt["JWT 검증<br/>AuthFilter"] --> exp{"만료?"}
  exp -->|예| tok["토큰 재발급<br/>TokenService"]
  exp -->|아니오| ord["주문 생성<br/>OrderController"]
  tok --> res(["응답<br/>200 / 401"])
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
    tab: "DB 스키마",
    src: `---
title: 주문 도메인 테이블
---
flowchart LR
  users[("users<br/>id · email")] -->|1:N| orders[("orders<br/>id · user_id · status")]
  orders -->|1:N| items[("order_items<br/>order_id · product_id")]
  products[("products<br/>id · price")] -->|1:N| items
  users -->|1:N| tokens[("refresh_tokens<br/>user_id · expires_at")]
  orders -.->|이벤트| events[("order_events<br/>order_id · type")]
  class users,orders,products done
  class events active
  class items current
  %% code: users db/migrations/001_users.sql:1
  %% code: orders db/migrations/003_orders.sql:1
  %% code: items db/migrations/004_order_items.sql:1`,
  },
  {
    tab: "배포 순서",
    src: `---
title: 주문 API 배포 순서
---
flowchart TB
  pr(["PR 머지<br/>main"]) --> ci["CI 빌드<br/>GitHub Actions"] --> test["통합 테스트<br/>pnpm test:e2e"]
  test --> ok{"통과?"}
  ok -->|예| stg["스테이징 배포<br/>k8s/staging"]
  ok -->|아니오| fix["수정<br/>hotfix 브랜치"]
  fix -.-> ci
  stg --> canary["카나리 10%<br/>argo rollouts"] --> prod(["프로덕션<br/>100%"])
  class pr,ci done
  class test current
  %% code: ci .github/workflows/ci.yml:1
  %% code: test e2e/orders.spec.ts:1`,
  },
];
