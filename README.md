# Rexony — Backend (`caa900-BE-grp04`)

AWS Lambda backend for the **CAA900 Capstone Project · Group 04**.
This repository owns **application code only.** Lambda resources, IAM roles, API Gateway routes, and DynamoDB tables are managed in [`caa900-IAC-grp04`](https://github.com/R3X0N05/caa900-IAC-grp04).

- Frontend → [`caa900-fp-grp04`](https://github.com/R3X0N05/caa900-fp-grp04)
- Infrastructure → [`caa900-IAC-grp04`](https://github.com/R3X0N05/caa900-IAC-grp04)

**Live site:** https://main.dijcvcdvudbc2.amplifyapp.com/

## Authors

- **Selva Roshan Sivagnanasundaram Rexon** (126332246) — [@R3X0N05](https://github.com/R3X0N05)
- **Tony Vu** (132798527) — [@tvu006](https://github.com/tvu006)

---

## Architecture

![Rexony Architecture Diagram](./architecture.jpg)

> Website visitors hit **CloudFront + WAF** for caching and security, then reach the **Amplify**-hosted SPA. The frontend authenticates through **Cognito**, calls **API Gateway** (JWT-protected), which routes to the appropriate **Lambda** function. Orders, products, and cart are stored in **DynamoDB**. The payment Lambda runs in a **VPC private subnet** and calls **Stripe**. Order events trigger **SES** confirmation emails via DynamoDB Streams. **CloudWatch** captures logs and alarms.

---

## Stack

- Node.js 22.x (ESM — `export const handler`)
- API Gateway (REST API, Cognito JWT Authorizer)
- DynamoDB (`@aws-sdk/lib-dynamodb`)
- Amazon SES (transactional order confirmation email)
- Stripe (hosted Checkout session)
- Amazon Cognito (user management via `@aws-sdk/client-cognito-identity-provider`)
- AWS Secrets Manager (`rexony/backend` — Stripe key + SES sender)

---

## Repository Structure

```
caa900-BE-grp04/
├── lambda/
│   ├── rexony-orders/       # Order creation, retrieval, status updates
│   ├── rexony-payment/      # Stripe Checkout session creation (VPC private subnet)
│   ├── rexony-products/     # Product catalogue CRUD + review/rating endpoints
│   ├── rexony-cart/         # Per-user cart management
│   ├── rexony-users/        # Admin — Cognito user list, update, delete
│   └── rexony-sns/          # DynamoDB Streams trigger → SES confirmation email
├── tests/                   # Jest test suite (unit + integration)
└── .github/workflows/
    ├── build.yml            # Build and test (PR / push)
    ├── security-check.yml   # Trivy vulnerability scan (PR / push)
    ├── load-test.yml        # Load and performance tests (PR / push)
    └── deploy.yml           # Detect changes → zip → Lambda deploy (merge to main)
```

---

## Function Registry

| Function | API Route(s) | Table / Service | Auth |
|---|---|---|---|
| `rexony-products` | `GET /products` `GET /products/{id}` `POST /products` `PUT /products/{id}` `DELETE /products/{id}` `GET /products/{id}/reviews` `POST /products/{id}/reviews` | `Products`, `Reviews` | Write: admin only; reviews: auth required |
| `rexony-cart` | `GET /cart` `POST /cart` `PUT /cart` `DELETE /cart/{productId}` `DELETE /cart/clear` | `Cart` | Required |
| `rexony-orders` | `GET /orders` `GET /orders/{id}` `POST /orders` `PUT /orders/{id}` | `Orders` | Required |
| `rexony-payment` | `POST /payment` | Stripe (VPC private subnet) | None |
| `rexony-users` | `GET /admin/users` `GET /admin/user/{id}` `PUT /admin/user/{id}` `DELETE /admin/user/{id}` | Cognito | Admin only |
| `rexony-sns` | DynamoDB Stream (`Orders` INSERT) | SES | N/A — event trigger |

---

## Secrets

Runtime secrets are stored in **AWS Secrets Manager** under the path `rexony/backend`. Lambda functions fetch them at cold-start. Never store secrets in environment variables or source code.

| Secret Key | Used by | Description |
|---|---|---|
| `STRIPE_SECRET_KEY` | `rexony-payment` | Stripe secret (`sk_test_…` / `sk_live_…`) |
| `FROM_EMAIL` | `rexony-orders`, `rexony-sns` | SES-verified sender address |

> After `terraform apply`, the IAC repo sets placeholder values. Replace `STRIPE_SECRET_KEY` manually in the AWS Secrets Manager console — Terraform's `ignore_changes` lifecycle prevents it from overwriting your real key on subsequent applies.

---

## Authorization

Protected routes require a **Cognito ID token** in the `Authorization` header:

```
Authorization: eyJhbGciOiJSUzI1NiIsInR5cCI6...
```

The API Gateway Cognito Authorizer validates the JWT and injects `requestContext.authorizer.claims`. Functions read:
- `claims.sub` — user ID
- `claims["custom:role"]` — role-based access control (`"admin"` or `"user"`)

---

## Email Flow (`rexony-sns`)

`rexony-sns` is not behind API Gateway. It is wired as a **DynamoDB Stream trigger** on the `Orders` table.

```
Customer places order
        ↓
rexony-orders writes INSERT to DynamoDB (Orders table)
        ↓
DynamoDB Stream fires INSERT event → rexony-sns
        ↓
Reads order items, totals, and customer email from stream image
        ↓
Amazon SES sends HTML order confirmation to customer
```

---

## CORS

All functions return:

```
Access-Control-Allow-Origin: *
Content-Type: application/json
```

OPTIONS preflight is handled at the **API Gateway level** via mock integrations. Lambda code does not handle OPTIONS.

> **Note:** Profile name updates bypass API Gateway entirely. The frontend calls Cognito's `user.updateAttributes()` directly via the Cognito Identity JS SDK, which handles its own CORS. This avoids any preflight issues on a `/me/update` route.

---

## CI/CD

GitHub Actions deploys only **function code** — it never runs `terraform apply` or creates functions. Lambda resources must exist in AWS (created by the IAC repo) before deployment.

```
Developer
   │
   ├── pull_request / push ──► build.yml           ──► build + test Lambda functions
   │                       ──► security-check.yml  ──► Trivy vulnerability scan
   │                       ──► load-test.yml        ──► load and performance tests
   │
   └── merge to main ────────► deploy.yml           ──► detect changed functions → zip
                                                        → aws lambda update-function-code
```

**IAM** — the deploy workflow assumes the `github_be_role_arn` OIDC role provisioned by the IAC repo. No static AWS credentials are stored in GitHub.

### Security Scanning

`security-check.yml` runs **Trivy** on every PR and push, scanning Lambda function source for known CVEs in dependencies. Builds with critical vulnerabilities are blocked from merging.

### GitHub Environment Setup

After running `terraform apply` in the IAC repo, configure the `production` environment in this repo:

| Setting | Value |
|---|---|
| `AWS_ROLE_ARN` | Value of `github_be_role_arn` Terraform output |
| `AWS_REGION` | `us-east-1` |

---

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production — protected; merges trigger Amplify auto-deploy and Lambda deploy |
| `new-infra` | Active development branch; PRs open against `main` (requires 1 review) |

Branch protection is enabled on `main`: pull request + 1 approving review required before merge.

---

## Local Development

```bash
git clone https://github.com/R3X0N05/caa900-BE-grp04.git
cd caa900-BE-grp04
npm install
```

### Running Tests

```bash
npm test
# or
npx jest
```

### Manual Deploy (single function)

```bash
cd lambda/rexony-products
zip -r function.zip .
aws lambda update-function-code \
  --function-name rexony-products \
  --zip-file fileb://function.zip
```

---

## DynamoDB Tables

| Table | Partition Key | Sort Key | Notes |
|---|---|---|---|
| `Products` | `productId` (S) | — | |
| `Orders` | `userId` (S) | `orderId` (S) | Streams enabled → triggers `rexony-sns` |
| `Cart` | `userId` (S) | `productId` (S) | |
| `Reviews` | `productId` (S) | `userId` (S) | Star ratings + text reviews |

Tables are provisioned by the IAC repo. This repo handles access patterns only. All tables have **Point-in-Time Recovery (PITR)** enabled (30-day window).

---
