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

**c) Pulumi.dev.yaml chứa placeholder:**
- `YOUR_GCP_PROJECT_ID` chưa được thay bằng project ID thật
- Fix: hardcode `fair-backbone-479312-h7` vào file

## 7. Chuyển GCP Project ID sang GitHub Variable

Mục tiêu: config GCP project ID ở 1 chỗ duy nhất (GitHub), không hardcode trong repo.

Các bước:
1. Tạo GitHub Variable `GCP_PROJECT_ID` (dùng `gh variable set`, hiển thị được, không bị mask)
2. Sửa `index.ts` — đọc project từ env var `GCP_PROJECT_ID`, fallback sang Pulumi config
3. Sửa `Pulumi.dev.yaml` — bỏ hardcode project ID, chỉ giữ region/zone
4. Sửa `deploy.yml` — truyền `GCP_PROJECT_ID: ${{ vars.GCP_PROJECT_ID }}` vào env
5. Xóa GitHub Secret `GCP_PROJECT_ID` (đã chuyển sang variable)

```bash
# Tạo variable
gh variable set GCP_PROJECT_ID --body "fair-backbone-479312-h7"

# Xóa secret cũ (đã chuyển sang variable)
gh secret delete GCP_PROJECT_ID
```

## 8. Fix IPv4 quota — xóa default node pool

CI chạy bị lỗi node pool tạo không được do hết quota external IPv4 (4/4).

Nguyên nhân: GKE bắt buộc `initialNodeCount: 1` → tạo 1 default node pool node (dùng 1 IP). Cộng thêm custom node pool 2 node = cần 3 IP chỉ riêng `gcp-infra`.

Fix: thêm `removeDefaultNodePool: true` vào cluster config. GKE tạo default pool rồi tự xóa ngay, chỉ giữ custom node pool 2 node.

## 9. Chuyển Pulumi stack sang personal account

Org `dongitran-org` expired trial → chuyển stack sang personal account `dongitran`.

- Sửa `deploy.yml`: `stack-name: dongitran/gcp-infra/dev`
- Xóa stack cũ `dongitran-org/gcp-infra/dev`
- Xóa hết resources trên GCP (cluster, subnet, VPC) rồi tạo lại từ đầu

## 10. Thêm NGINX Ingress Controller

Deploy NGINX Ingress Controller vào cluster qua Helm chart để expose services ra ngoài.

- Helm chart: `ingress-nginx/ingress-nginx` v4.12.0
- Namespace: `ingress-nginx`
- Service type: `LoadBalancer` (GCP tự tạo external IP)
- 1 replica, resource limits: 250m CPU / 256Mi RAM

Lấy external IP:
```bash
kubectl get svc -n ingress-nginx ingress-nginx-controller
```
