---
description: Sync GKE cluster IPs and database connection URIs to Bitwarden vault
---

# Sync GCP Infra Info to Bitwarden

Fetches current IPs from GKE cluster and builds database connection URIs using passwords
from Bitwarden, then saves everything back to Bitwarden Secure Notes.

**Bitwarden folder:** `Google Cloud Platform` (ID: `9992f6a3-d7c6-424e-8baf-b3f00131fa94`)

**Password key names** (from `.agent/config/secrets.yml`):
- PostgreSQL → `GCP_INFRA_DEV_POSTGRES_PASSWORD`
- MongoDB    → `GCP_INFRA_DEV_MONGODB_PASSWORD`
- Redis      → `GCP_INFRA_DEV_REDIS_PASSWORD`

**Keys managed:**
| Bitwarden Key | Type | Item ID |
|---|---|---|
| `GCP_INFRA_LOAD_BALANCER_IP` | IP | `730b3c5e-67af-42de-a847-b40600cf54e4` |
| `GCP_INFRA_NODE_IP_1` | IP | `0caaf2fd-9915-4062-a565-b40600cf5b9f` |
| `GCP_INFRA_NODE_IP_2` | IP | `933f7cc4-ebe4-480b-bd01-b40600cf63bd` |
| `GCP_INFRA_MONGODB_URI` | URI | upsert by name |
| `GCP_INFRA_POSTGRES_URI` | URI | upsert by name |
| `GCP_INFRA_REDIS_URI` | URI | upsert by name |

---

## Steps

### Phase 1: Fetch IPs from GKE

1. Authenticate and get credentials for the GKE cluster

```bash
gcloud container clusters get-credentials gcp-infra --zone asia-southeast1-a
```

2. Fetch the Load Balancer (Ingress) external IP

```bash
LB_IP=$(kubectl get svc -n ingress-nginx -l app.kubernetes.io/component=controller \
  -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
echo "Load Balancer IP: $LB_IP"
```

3. Fetch Node external IPs (sorted alphabetically for stable ordering across runs)

```bash
NODE_IPS=($(kubectl get nodes \
  -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="ExternalIP")].address}{"\n"}{end}' \
  | sort))
NODE_IP_1="${NODE_IPS[0]}"
NODE_IP_2="${NODE_IPS[1]}"
echo "Node IP 1: $NODE_IP_1"
echo "Node IP 2: $NODE_IP_2"
```

---

### Phase 2: Fetch Passwords from Bitwarden

4. Dùng MCP Bitwarden lấy notes của 3 keys password:
   - `GCP_INFRA_DEV_POSTGRES_PASSWORD` → `POSTGRES_PASSWORD`
   - `GCP_INFRA_DEV_MONGODB_PASSWORD`  → `MONGODB_PASSWORD`
   - `GCP_INFRA_DEV_REDIS_PASSWORD`    → `REDIS_PASSWORD`

---

### Phase 3: Build Connection URIs

5. Build connection URIs sử dụng `NODE_IP_1` làm primary node:

   - **MongoDB URI** (NodePort):
     ```
     mongodb://admin:<MONGODB_PASSWORD>@<NODE_IP_1>:30017/?authSource=admin
     ```
     > Username là `admin` (CloudPirates chart default: `MONGO_INITDB_ROOT_USERNAME=admin`)

   - **PostgreSQL URI** (NodePort):
     ```
     postgresql://postgres:<POSTGRES_PASSWORD>@<NODE_IP_1>:30432/app
     ```

   - **Redis URI** (ClusterIP — internal cluster only):
     ```
     redis://:<REDIS_PASSWORD>@redis-master.databases.svc.cluster.local:6379
     ```

---

### Phase 4: Update IPs in Bitwarden

6. Dùng MCP Bitwarden update `notes` của 3 IP keys (dùng Item ID đã biết ở bảng trên):
   - `GCP_INFRA_LOAD_BALANCER_IP` ← `LB_IP`
   - `GCP_INFRA_NODE_IP_1` ← `NODE_IP_1`
   - `GCP_INFRA_NODE_IP_2` ← `NODE_IP_2`

---

### Phase 5: Save URIs to Bitwarden (upsert)

7. Với mỗi URI key: tìm kiếm trong Bitwarden theo tên trong folder `Google Cloud Platform`.
   - Nếu **tồn tại**: update `notes`
   - Nếu **chưa có**: tạo mới Secure Note trong folder, `notes` = URI

   Các keys cần upsert: `GCP_INFRA_MONGODB_URI`, `GCP_INFRA_POSTGRES_URI`, `GCP_INFRA_REDIS_URI`

---

### Phase 6: Verify

8. Tìm kiếm trong Bitwarden tất cả items trong folder `Google Cloud Platform` với từ khoá `GCP_INFRA`,
   xác nhận 6 keys có giá trị đúng.

---

## Notes

- Node IPs sorted alphabetically → `NODE_IP_1` / `NODE_IP_2` ổn định qua các lần chạy.
- Passwords không lưu trong file này — luôn fetch live từ Bitwarden khi chạy.
- Redis URI chỉ hoạt động trong cluster. Lưu vào Bitwarden để tham khảo/chia sẻ.
- Chạy workflow này sau mỗi lần `pulumi up` khi IPs có thể thay đổi.
