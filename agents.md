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
4. **Node Pool** (`gcp-infra-nodes`) - 2x `e2-medium` nodes, 50GB `pd-balanced` (SSD) disk, auto-repair/upgrade enabled
5. **Kubernetes Provider** (`gke-k8s`) - For managing K8s resources via Pulumi
6. **NGINX Ingress Controller** (`ingress-nginx`) - Helm chart v4.12.0, 2 replicas with pod anti-affinity, LoadBalancer service for external traffic, resources: 200m/256Mi requests, 1000m/512Mi limits
7. **ArgoCD** (`argocd`) - Helm chart v7.7.11, GitOps continuous delivery platform with HA configuration (2 server replicas, 2 repo-server replicas)

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

## ArgoCD Configuration

ArgoCD is deployed with the following architecture:

### Components
| Component | Replicas | Resources | Notes |
|-----------|----------|-----------|-------|
| Server | 2 | 100m/256Mi - 500m/512Mi | HA with pod anti-affinity |
| Repo Server | 2 | 100m/256Mi - 500m/512Mi | Helm support enabled |
| Application Controller | 1 | 250m/512Mi - 1000m/1Gi | Stateful component |
| ApplicationSet | 2 | 100m/256Mi - 250m/512Mi | GitOps application generator |
| Notifications | 1 | 50m/128Mi - 100m/256Mi | Webhook notifications |
| Redis | 1 | 100m/128Mi - 250m/256Mi | Cache for ArgoCD |

### Access Methods
1. **Via Ingress**: `https://argocd.local` (update DNS or /etc/hosts)
2. **Via Port-forward**: `kubectl port-forward svc/argocd-server -n argocd 8080:80`

### Initial Setup
```bash
# Get admin password
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

# Login via CLI
argocd login argocd.local --username admin --password <password>

# Change admin password
argocd account update-password --current-password <initial> --new-password <new>
```

### Security Notes
- TLS terminated at NGINX Ingress Controller
- ArgoCD server runs in insecure mode (HTTP) behind ingress
- Admin auth enabled with auto-generated initial password
- Anonymous access disabled

## Exports

The stack exports these values for use by other stacks or scripts:

- `clusterEndpoint` - GKE API server endpoint
- `clusterCaCertificate` - Cluster CA certificate
- `kubeconfigOutput` - Full kubeconfig for kubectl
- `clusterNameOutput` - Cluster name
- `networkName` - VPC network name
- `ingressNginxStatus` - NGINX Ingress Controller Helm release status
- `argocdNamespace` - ArgoCD namespace name
- `argocdStatus` - ArgoCD Helm release status
- `argocdIngressName` - ArgoCD Ingress resource name
- `argocdAdminPassword` - Initial admin password (sensitive)
- `argocdAccessInfo` - ArgoCD access instructions
