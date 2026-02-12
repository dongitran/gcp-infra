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
| 🖥️ **Node Pool** | 2x `e2-medium`, 50GB disk, auto-repair & auto-upgrade |

## 🚀 Getting Started

```bash
# 1️⃣ Install dependencies
npm install

# 2️⃣ Login to Pulumi
pulumi login

# 3️⃣ Init stack
pulumi stack init dev

# 4️⃣ Set GCP project
pulumi config set gcp-infra:gcp-project YOUR_GCP_PROJECT_ID

# 5️⃣ Preview changes
pulumi preview

# 6️⃣ Deploy
pulumi up
```

## ⚙️ Configuration

| Key | Required | Default |
|-----|----------|---------|
| `gcp-project` | ✅ | — |
| `gcp-region` | ❌ | `asia-southeast1` |
| `gcp-zone` | ❌ | `asia-southeast1-a` |
| `cluster-name` | ❌ | `gcp-infra` |

## 📁 Project Structure

```
gcp-infra/
├── index.ts            # 🏗️ Main infrastructure definition
├── Pulumi.yaml         # 📋 Pulumi project config
├── Pulumi.dev.yaml     # 🔧 Dev environment config
├── package.json        # 📦 Dependencies
├── tsconfig.json       # ⚙️ TypeScript config
├── agents.md           # 🤖 AI agent context
└── README.md           # 📖 This file
```

## 📤 Stack Exports

- `clusterEndpoint` — GKE API server endpoint
- `kubeconfigOutput` — Full kubeconfig for `kubectl`
- `clusterNameOutput` — Cluster name
- `networkName` — VPC network name

## 🗑️ Tear Down

```bash
pulumi destroy
```

## 📝 License

MIT
