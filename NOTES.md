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
export PULUMI_ACCESS_TOKEN="pul-xxx..."
export PULUMI_CONFIG_PASSPHRASE=""
pulumi stack init dev
```

Stack name đầy đủ trên Pulumi Cloud: `dongitran-org/gcp-infra/dev`

## 3. GCP Service Account cho CI

Tạo SA `gcp-infra-ci` với role `editor` + `container.admin`:
```bash
gcloud iam service-accounts create gcp-infra-ci --display-name="GCP Infra CI" --project=fair-backbone-479312-h7

gcloud projects add-iam-policy-binding fair-backbone-479312-h7 \
  --member="serviceAccount:gcp-infra-ci@fair-backbone-479312-h7.iam.gserviceaccount.com" \
  --role="roles/editor"

gcloud projects add-iam-policy-binding fair-backbone-479312-h7 \
  --member="serviceAccount:gcp-infra-ci@fair-backbone-479312-h7.iam.gserviceaccount.com" \
  --role="roles/container.admin"
```

Tạo JSON key (lưu tạm, set secret xong thì xóa):
```bash
gcloud iam service-accounts keys create /tmp/gcp-infra-ci-key.json \
  --iam-account=gcp-infra-ci@fair-backbone-479312-h7.iam.gserviceaccount.com

# Sau khi set GitHub secret xong:
rm /tmp/gcp-infra-ci-key.json
```

## 4. GitHub Actions Secrets

Set 3 secrets trên repo `dongitran/gcp-infra`:
```bash
gh secret set PULUMI_ACCESS_TOKEN --body "pul-xxx..."
gh secret set GCP_CREDENTIALS < /tmp/gcp-infra-ci-key.json
gh secret set GCP_PROJECT_ID --body "fair-backbone-479312-h7"
```

| Secret | Giá trị |
|--------|---------|
| `PULUMI_ACCESS_TOKEN` | Pulumi Cloud access token |
| `GCP_CREDENTIALS` | Service Account JSON key |
| `GCP_PROJECT_ID` | `fair-backbone-479312-h7` |

## 5. GitHub Actions Workflow

File `.github/workflows/deploy.yml` — tự chạy `pulumi up` khi push lên `main`.

Workflow sử dụng:
- `PULUMI_ACCESS_TOKEN` — login Pulumi Cloud
- `PULUMI_CONFIG_PASSPHRASE=""` — không mã hóa secrets trong state
- `pulumi/actions@v6` — Pulumi GitHub Action
- `google-github-actions/auth@v2` — xác thực GCP
- Stack name: `dev`

## 6. Fix lỗi CI lần đầu

Lần chạy đầu bị lỗi 2 vấn đề:

**a) GCP credentials không được nhận:**
- Ban đầu dùng env `GOOGLE_CREDENTIALS` trực tiếp — Pulumi GCP provider không nhận
- Fix: thêm step `google-github-actions/auth@v2` để authenticate đúng cách (set ADC)
- Bỏ `GOOGLE_CREDENTIALS` khỏi env global

**b) Pulumi org expired trial:**
- Org `dongitran-org` đang expired trial/canceled subscription
- Cần vào https://app.pulumi.com/dongitran-org/ để chuyển về free plan hoặc transfer stack sang personal account
