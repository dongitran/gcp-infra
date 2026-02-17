# GCP Infrastructure

Pulumi IaC project provisioning GKE cluster on GCP.

## Tech Stack
- **IaC**: Pulumi (TypeScript)
- **Cloud**: GCP
- **CI/CD**: GitHub Actions
- **State**: Pulumi Cloud

## Resources

| Resource | Config |
|----------|--------|
| GKE Cluster | Zonal, 2x e2-medium, SSD |
| VPC | Custom, 10.0.0.0/24 |
| Ingress | NGINX, LoadBalancer |

## Exports

- `clusterEndpoint`, `clusterNameOutput`
- `kubeconfigOutput` (secret)
- `ingressNginxStatus`

## Commands

```bash
pulumi login
pulumi preview
pulumi up
pulumi destroy
```
