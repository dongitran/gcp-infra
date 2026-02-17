# ☁️ GCP Infrastructure

> 🏗️ Infrastructure as Code for Google Cloud Platform using Pulumi

## 📦 Tech Stack

- **IaC Tool:** Pulumi
- **Language:** TypeScript
- **Cloud:** Google Cloud Platform

## 🌐 What Gets Deployed

| Resource | Details |
|----------|---------|
| 🔗 **VPC Network** | Custom VPC, no auto-subnets |
| 🧩 **Subnet** | `10.0.0.0/24` + secondary ranges for pods & services |
| ☸️ **GKE Cluster** | Zonal, STABLE channel, Workload Identity |
| 🖥️ **Node Pool** | 2x `e2-medium`, 50GB SSD (pd-balanced), auto-repair & auto-upgrade |
| 🌐 **NGINX Ingress** | Helm chart, 2 replicas, LoadBalancer service for external traffic |

## 🚀 Getting Started

```bash
# 1️⃣ Install dependencies
npm install

# 2️⃣ Login to Pulumi
pulumi login

# 3️⃣ Init stack
pulumi stack init dev

# 4️⃣ Set GCP project (or export GCP_PROJECT_ID env var)
export GCP_PROJECT_ID="your-gcp-project-id"

# 5️⃣ Preview changes
pulumi preview

# 6️⃣ Deploy
pulumi up
```

## ⚙️ Configuration

| Key | Source | Default |
|-----|--------|---------|
| `GCP_PROJECT_ID` | Env var / GitHub Variable | — |
| `gcp-region` | Pulumi config | `asia-southeast1` |
| `gcp-zone` | Pulumi config | `asia-southeast1-a` |
| `cluster-name` | Pulumi config | `gcp-infra` |

## 🔄 CI/CD

Push to `main` triggers GitHub Actions workflow that runs `pulumi up` automatically.  
**Concurrency control** ensures commits run sequentially (no parallel deploys).

Requires GitHub Secrets/Variables:
- 🔑 `PULUMI_ACCESS_TOKEN` (Secret)
- 🔑 `GCP_CREDENTIALS` (Secret) — Service Account JSON key
- 📋 `GCP_PROJECT_ID` (Variable)
- 🗄️ `POSTGRES_PASSWORD` (Secret) — PostgreSQL password
- 🔴 `REDIS_PASSWORD` (Secret) — Redis password
- 🍃 `MONGODB_PASSWORD` (Secret) — MongoDB password
- 🔔 `TELEGRAM_BOT_TOKEN` (Secret) — Deploy notification bot
- 🔔 `TELEGRAM_CHAT_ID` (Secret) — Deploy notification chat

## 📁 Project Structure

```
gcp-infra/
├── .github/workflows/
│   └── deploy.yml      # 🚀 CI/CD — auto deploy on push to main
├── index.ts            # 🏗️ Main infrastructure definition
├── Pulumi.yaml         # 📋 Pulumi project config
├── package.json        # 📦 Dependencies
├── tsconfig.json       # ⚙️ TypeScript config
├── NOTES.md            # 📝 Setup steps & troubleshooting
├── agents.md           # 🤖 AI agent context
├── .gitignore          # 🙈 Ignore rules
└── README.md           # 📖 This file
```

## 📤 Stack Exports

- `clusterEndpoint` — GKE API server endpoint
- `clusterCaCertificate` — Cluster CA certificate
- `kubeconfigOutput` — Full kubeconfig for `kubectl`
- `clusterNameOutput` — Cluster name
- `networkName` — VPC network name
- `ingressNginxLoadBalancerIP` — NGINX Ingress external IP
- `ingressNginxStatus` — NGINX Ingress Controller status

## 🗑️ Tear Down

```bash
pulumi destroy
```

## 📝 License

MIT
