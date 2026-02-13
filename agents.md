# GCP Infrastructure - AI Agent Context

## Project Overview

This is a Pulumi Infrastructure as Code (IaC) project that provisions a Google Kubernetes Engine (GKE) cluster on Google Cloud Platform.

## Tech Stack

- **IaC Tool**: Pulumi
- **Language**: TypeScript
- **Cloud Provider**: Google Cloud Platform (GCP)
- **Package Manager**: npm

## Project Structure

```
gcp-infra/
├── .github/workflows/
│   └── deploy.yml      # CI/CD — auto pulumi up on push to main
├── index.ts            # Main infrastructure definition (all GCP resources)
├── Pulumi.yaml         # Pulumi project configuration
├── Pulumi.dev.yaml     # Dev stack config (region, zone)
├── package.json        # Node.js dependencies
├── tsconfig.json       # TypeScript compiler options
├── NOTES.md            # Setup steps & troubleshooting notes
├── agents.md           # This file - AI context
├── .gitignore          # Ignore node_modules, secrets, state
└── README.md           # Project documentation
```

## GCP Resources Provisioned

1. **VPC Network** (`gcp-infra-network`) - Custom VPC with no auto-subnets
2. **Subnet** (`gcp-infra-subnet`) - Primary CIDR `10.0.0.0/24` with secondary ranges for pods and services
3. **GKE Cluster** (`gcp-infra-cluster`) - Zonal cluster with Workload Identity, STABLE release channel, default node pool removed
4. **Node Pool** (`gcp-infra-nodes`) - 2x `e2-medium` nodes, 50GB `pd-standard` disk, auto-repair/upgrade enabled
5. **Kubernetes Provider** (`gke-k8s`) - For managing K8s resources via Pulumi
6. **NGINX Ingress Controller** (`ingress-nginx`) - Helm chart v4.12.0, 1 replica, LoadBalancer service for external traffic

## Key Configuration

GCP Project ID: đọc từ env var `GCP_PROJECT_ID` trước, fallback sang Pulumi config `gcp-project`.

| Key | Source | Default |
|-----|--------|---------|
| `GCP_PROJECT_ID` | Env var (CI: GitHub Variable) | — |
| `gcp-project` | Pulumi config (fallback) | — |
| `gcp-region` | Pulumi config | `asia-southeast1` |
| `gcp-zone` | Pulumi config | `asia-southeast1-a` |
| `cluster-name` | Pulumi config | `gcp-infra` |

## CI/CD

- GitHub Actions workflow: `.github/workflows/deploy.yml`
- Trigger: push to `main`
- Auth: `google-github-actions/auth@v2` với Service Account key
- Deploy: `pulumi/actions@v6` với `upsert: true`
- State: Pulumi Cloud (`dongitran/gcp-infra/dev`)

GitHub Secrets/Variables:
| Name | Type | Mô tả |
|------|------|-------|
| `PULUMI_ACCESS_TOKEN` | Secret | Pulumi Cloud token |
| `GCP_CREDENTIALS` | Secret | Service Account JSON key |
| `GCP_PROJECT_ID` | Variable | GCP project ID |
| `TELEGRAM_BOT_TOKEN` | Secret | Telegram bot token for deploy notifications |
| `TELEGRAM_CHAT_ID` | Secret | Telegram chat ID for deploy notifications |

## Common Commands

```bash
npm install              # Install dependencies
pulumi login             # Login to Pulumi backend
pulumi preview           # Preview changes
pulumi up                # Deploy infrastructure
pulumi destroy           # Tear down infrastructure
```

## Exports

The stack exports these values for use by other stacks or scripts:

- `clusterEndpoint` - GKE API server endpoint
- `clusterCaCertificate` - Cluster CA certificate
- `kubeconfigOutput` - Full kubeconfig for kubectl
- `clusterNameOutput` - Cluster name
- `networkName` - VPC network name
- `ingressNginxStatus` - NGINX Ingress Controller Helm release status
