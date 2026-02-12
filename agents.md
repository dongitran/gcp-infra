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
├── index.ts            # Main infrastructure definition (all GCP resources)
├── Pulumi.yaml         # Pulumi project configuration
├── Pulumi.dev.yaml     # Dev stack config (GCP project, region, zone)
├── package.json        # Node.js dependencies
├── tsconfig.json       # TypeScript compiler options
├── agents.md           # This file - AI context
└── README.md           # Project documentation
```

## GCP Resources Provisioned

1. **VPC Network** (`gcp-infra-network`) - Custom VPC with no auto-subnets
2. **Subnet** (`gcp-infra-subnet`) - Primary CIDR `10.0.0.0/24` with secondary ranges for pods and services
3. **GKE Cluster** (`gcp-infra-cluster`) - Zonal cluster with Workload Identity, STABLE release channel
4. **Node Pool** (`gcp-infra-nodes`) - 2x `e2-medium` nodes, 50GB `pd-standard` disk, auto-repair/upgrade enabled
5. **Kubernetes Provider** (`gke-k8s`) - For managing K8s resources via Pulumi

## Key Configuration

Config values are read from Pulumi stack config (`Pulumi.dev.yaml`):

| Key | Required | Default |
|-----|----------|---------|
| `gcp-project` | Yes | - |
| `gcp-region` | No | `asia-southeast1` |
| `gcp-zone` | No | `asia-southeast1-a` |
| `cluster-name` | No | `gcp-infra` |

## Common Commands

```bash
npm install              # Install dependencies
pulumi login             # Login to Pulumi backend
pulumi stack init dev    # Initialize dev stack
pulumi config set gcp-infra:gcp-project <PROJECT_ID>  # Set GCP project
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
