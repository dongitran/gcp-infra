---
description: Deploy gcp-infra project to a new GCP account/cluster from scratch
---

# Deploy to New GCP Cluster

Step-by-step guide to deploy this Pulumi project to a fresh GCP account.

// turbo-all

## Prerequisites

- `gcloud` CLI installed and authenticated with the new GCP account
- `gh` CLI authenticated with GitHub
- Pulumi stack already reset (run `Reset Pulumi Stack` workflow first)
- Billing account linked to the GCP account

## Steps

1. Verify gcloud is logged in with the correct account

```bash
gcloud auth list
```

2. Create a new GCP project (or skip if using an existing one). GCP will auto-generate a project ID based on the name.

```bash
gcloud projects create --name="gcp-infra"
```

3. Set the new project as active

```bash
gcloud config set project <PROJECT_ID>
```

4. Confirm the active project

```bash
gcloud config get-value project
```

5. Link a Billing Account to the project. List available billing accounts first, then link one.

```bash
gcloud billing accounts list
gcloud billing projects link $(gcloud config get-value project) --billing-account=<BILLING_ACCOUNT_ID>
```

6. Enable required GCP APIs

```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud services enable compute.googleapis.com --project=$PROJECT_ID
gcloud services enable container.googleapis.com --project=$PROJECT_ID
```

7. Create a Service Account for CI/CD

```bash
PROJECT_ID=$(gcloud config get-value project)

gcloud iam service-accounts create gcp-infra-ci \
  --display-name="GCP Infra CI" \
  --project=$PROJECT_ID
```

8. Grant required IAM roles to the Service Account

```bash
PROJECT_ID=$(gcloud config get-value project)
SA_EMAIL="gcp-infra-ci@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/editor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA_EMAIL" \
  --role="roles/container.admin"
```

9. Generate a JSON key for the Service Account

```bash
PROJECT_ID=$(gcloud config get-value project)
SA_EMAIL="gcp-infra-ci@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts keys create /tmp/gcp-infra-ci-key.json \
  --iam-account=$SA_EMAIL
```

10. Update GitHub Secrets with the new credentials. Use `gh secret set` with file input for `GCP_CREDENTIALS` to preserve JSON formatting.

```bash
PROJECT_ID=$(gcloud config get-value project)

gh secret set GCP_CREDENTIALS < /tmp/gcp-infra-ci-key.json --repo dongitran/gcp-infra
gh secret set GCP_PROJECT_ID --body "$PROJECT_ID" --repo dongitran/gcp-infra
```

11. Store the new credentials in Bitwarden using MCP. Use the folder `Google Cloud Platform` (ID: `9992f6a3-d7c6-424e-8baf-b3f00131fa94`).

- **Service Account key**: Create a secure note named `GCP_SERVICE_ACCOUNT_GCP_INFRA` with the JSON content of `/tmp/gcp-infra-ci-key.json`
- **Project ID**: Create a secure note named `GCP_INFRA_PROJECT_ID_GCP_INFRA` with the project ID as notes

Use `mcp_bitwarden_create_item` with `type: 2` (Secure Note), `folderId: "9992f6a3-d7c6-424e-8baf-b3f00131fa94"`, and put the value in the `notes` field.

12. Clean up the local key file — it's now stored in GitHub Secrets

```bash
rm /tmp/gcp-infra-ci-key.json
```

13. Trigger a new deploy workflow

```bash
gh workflow run "Deploy GKE Infrastructure" --repo dongitran/gcp-infra
```

14. Monitor the deployment progress

```bash
sleep 30 && gh run list --repo dongitran/gcp-infra --workflow="deploy.yml" --limit 1
```

15. Once the run is in progress, watch the logs

```bash
gh run watch --repo dongitran/gcp-infra
```

16. After successful deploy, verify the resources on GCP

```bash
PROJECT_ID=$(gcloud config get-value project)
gcloud container clusters list --project=$PROJECT_ID
gcloud compute addresses list --project=$PROJECT_ID
```

## Post-Deploy Checklist

- [ ] GKE cluster is `RUNNING`
- [ ] NGINX Ingress has external IP
- [ ] PostgreSQL pod is running (`kubectl get pods -n databases`)
- [ ] Redis pod is running
- [ ] MongoDB pod is running
- [ ] Telegram notification received ✅
