# GCP Infrastructure - AI Agent Context

Pulumi IaC project provisioning GKE cluster on GCP.

## Infrastructure Overview

| Component | Config |
|-----------|--------|
| **GKE Cluster** | Zonal, 2x e2-medium nodes, 50GB SSD |
| **VPC** | Custom, 10.0.0.0/24, secondary ranges for pods/services |
| **Ingress** | NGINX Controller v4.12.0, LoadBalancer (34.177.107.211) |
| **Location** | asia-southeast1-a |

## Project Structure

```
gcp-infra/
├── index.ts            # Main infrastructure definition
├── .github/workflows/
│   └── deploy.yml      # CI/CD - auto deploy on push to main
├── Pulumi.yaml         # Pulumi project config
└── NOTES.md            # Setup & troubleshooting
```

## Common Commands

```bash
# Install dependencies
npm install

# Pulumi commands
pulumi login                    # Login to Pulumi Cloud
pulumi stack select dev         # Select stack
pulumi preview                  # Preview changes
pulumi up                       # Deploy infrastructure
pulumi destroy                  # Tear down everything
pulumi stack output             # Show all outputs

# GCP commands (local)
gcloud container clusters get-credentials gcp-infra --zone asia-southeast1-a
kubectl get nodes
kubectl get svc -n ingress-nginx
```

## Configuration

| Key | Source | Default |
|-----|--------|---------|
| `GCP_PROJECT_ID` | Env var / GitHub Variable | — |
| `gcp-region` | Pulumi config | `asia-southeast1` |
| `gcp-zone` | Pulumi config | `asia-southeast1-a` |
| `cluster-name` | Pulumi config | `gcp-infra` |

## Stack Outputs

- `clusterEndpoint` - GKE API endpoint
- `clusterNameOutput` - Cluster name
- `clusterLocation` - Zone
- `kubeconfigOutput` - Kubeconfig (secret)
- `ingressNginxStatus` - Ingress controller status

## CI/CD

- **Trigger**: Push to `main`
- **State**: Pulumi Cloud (`dongitran/gcp-infra/dev`)
- **Secrets**: `PULUMI_ACCESS_TOKEN`, `GCP_CREDENTIALS`, `GCP_PROJECT_ID`

## Notes

- **Security**: Kubeconfig is NOT exported to artifacts (previous incident fixed)
- **Node Pool**: Uses `replaceOnChanges` for disk type changes
- **Ingress**: TLS terminated at NGINX, insecure backend
