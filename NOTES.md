# Notes

## 1. Pulumi Backend

Ban đầu dùng local state:
```bash
pulumi login file://.
```

Sau chuyển sang Pulumi Cloud để CI dùng được:
```bash
export PULUMI_ACCESS_TOKEN="pul-xxx..."
pulumi login --cloud-url https://api.pulumi.com
```

Stack dashboard: https://app.pulumi.com/dongitran-org/gcp-infra/dev

## 2. Init Stack

```bash
pulumi stack init dev
```

## 3. GCP Service Account cho CI

Tạo SA `gcp-infra-ci` với role `editor` + `container.admin`:
```bash
gcloud iam service-accounts create gcp-infra-ci --display-name="GCP Infra CI" --project=fair-backbone-479312-h7
gcloud projects add-iam-policy-binding fair-backbone-479312-h7 --member="serviceAccount:gcp-infra-ci@fair-backbone-479312-h7.iam.gserviceaccount.com" --role="roles/editor"
gcloud projects add-iam-policy-binding fair-backbone-479312-h7 --member="serviceAccount:gcp-infra-ci@fair-backbone-479312-h7.iam.gserviceaccount.com" --role="roles/container.admin"
gcloud iam service-accounts keys create key.json --iam-account=gcp-infra-ci@fair-backbone-479312-h7.iam.gserviceaccount.com
```

## 4. GitHub Actions Secrets

Đã set 3 secrets trên repo `dongitran/gcp-infra`:
```
PULUMI_ACCESS_TOKEN  = Pulumi Cloud token
GCP_CREDENTIALS      = Service Account JSON key
GCP_PROJECT_ID       = fair-backbone-479312-h7
```

## 5. GitHub Actions Workflow

File `.github/workflows/deploy.yml` — tự chạy `pulumi up` khi push lên `main`.
