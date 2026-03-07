---
description: Sync GKE cluster IPs and database connection URIs to Bitwarden vault
---

# Sync GCP Infra Info to Bitwarden

Fetches current IPs from GKE cluster and builds database connection URIs using passwords
from Bitwarden, then saves everything back to Bitwarden Secure Notes.

**Bitwarden folder:** `Google Cloud Platform` (ID: `9992f6a3-d7c6-424e-8baf-b3f00131fa94`)

**Password key names** (from `.agent/config/secrets.yml`):
- PostgreSQL password → Bitwarden key: `GCP_INFRA_DEV_POSTGRES_PASSWORD`
- MongoDB password   → Bitwarden key: `GCP_INFRA_DEV_MONGODB_PASSWORD`
- Redis password     → Bitwarden key: `GCP_INFRA_DEV_REDIS_PASSWORD`

**Keys managed (IPs):**
| Bitwarden Key | Description | Item ID |
|---|---|---|
| `GCP_INFRA_LOAD_BALANCER_IP` | NGINX Ingress external IP | `730b3c5e-67af-42de-a847-b40600cf54e4` |
| `GCP_INFRA_NODE_IP_1` | GKE Node 1 external IP | `0caaf2fd-9915-4062-a565-b40600cf5b9f` |
| `GCP_INFRA_NODE_IP_2` | GKE Node 2 external IP | `933f7cc4-ebe4-480b-bd01-b40600cf63bd` |

**Keys managed (URIs):**
| Bitwarden Key | Description |
|---|---|
| `GCP_INFRA_MONGODB_URI` | MongoDB connection string (NodePort) |
| `GCP_INFRA_POSTGRES_URI` | PostgreSQL connection string (NodePort) |
| `GCP_INFRA_REDIS_URI` | Redis connection string (ClusterIP - internal only) |

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

### Phase 2: Fetch Passwords from Bitwarden via MCP

4. Fetch PostgreSQL password from Bitwarden using MCP

   Call `mcp_bitwarden_get` with:
   - `object: "item"`
   - `id: "GCP_INFRA_DEV_POSTGRES_PASSWORD"`

   Save the `notes` field value as `POSTGRES_PASSWORD`.

5. Fetch MongoDB password from Bitwarden using MCP

   Call `mcp_bitwarden_get` with:
   - `object: "item"`
   - `id: "GCP_INFRA_DEV_MONGODB_PASSWORD"`

   Save the `notes` field value as `MONGODB_PASSWORD`.

6. Fetch Redis password from Bitwarden using MCP

   Call `mcp_bitwarden_get` with:
   - `object: "item"`
   - `id: "GCP_INFRA_DEV_REDIS_PASSWORD"`

   Save the `notes` field value as `REDIS_PASSWORD`.

---

### Phase 3: Build Connection URIs

7. Build connection URIs using `NODE_IP_1` as the primary node IP

   - **MongoDB URI** (NodePort, use NODE_IP_1):
     ```
     mongodb://root:<MONGODB_PASSWORD>@<NODE_IP_1>:30017
     ```

   - **PostgreSQL URI** (NodePort, use NODE_IP_1):
     ```
     postgresql://postgres:<POSTGRES_PASSWORD>@<NODE_IP_1>:30432/app
     ```

   - **Redis URI** (ClusterIP — internal cluster only, not accessible outside):
     ```
     redis://:<REDIS_PASSWORD>@redis-master.databases.svc.cluster.local:6379
     ```

   > **Note:** Redis uses ClusterIP, so its URI only works inside the cluster (e.g., from another pod).
   > Access from outside requires `kubectl port-forward pod/redis-0 6379:6379 -n databases`.

---

### Phase 4: Update IPs in Bitwarden via MCP

8. Update `GCP_INFRA_LOAD_BALANCER_IP`

   Call `mcp_bitwarden_edit_item` with:
   - `id: "730b3c5e-67af-42de-a847-b40600cf54e4"`
   - `notes: <LB_IP>`

9. Update `GCP_INFRA_NODE_IP_1`

   Call `mcp_bitwarden_edit_item` with:
   - `id: "0caaf2fd-9915-4062-a565-b40600cf5b9f"`
   - `notes: <NODE_IP_1>`

10. Update `GCP_INFRA_NODE_IP_2`

    Call `mcp_bitwarden_edit_item` with:
    - `id: "933f7cc4-ebe4-480b-bd01-b40600cf63bd"`
    - `notes: <NODE_IP_2>`

---

### Phase 5: Save URIs to Bitwarden via MCP

For each URI key below: first search Bitwarden by name using `mcp_bitwarden_list` with
`folderid: "9992f6a3-d7c6-424e-8baf-b3f00131fa94"` and `search: <key_name>`.
- If item **exists**: use `mcp_bitwarden_edit_item` to update `notes`
- If item **does not exist**: use `mcp_bitwarden_create_item` with `type: 2` (Secure Note),
  `folderId: "9992f6a3-d7c6-424e-8baf-b3f00131fa94"`, and put the URI in `notes`

11. Save MongoDB URI → key name: `GCP_INFRA_MONGODB_URI`

12. Save PostgreSQL URI → key name: `GCP_INFRA_POSTGRES_URI`

13. Save Redis URI → key name: `GCP_INFRA_REDIS_URI`

---

### Phase 6: Verify

14. List all managed keys from Bitwarden to confirm values are correct

    Call `mcp_bitwarden_list` with:
    - `type: "items"`
    - `folderid: "9992f6a3-d7c6-424e-8baf-b3f00131fa94"`
    - `search: "GCP_INFRA"`

    Verify that `GCP_INFRA_LOAD_BALANCER_IP`, `GCP_INFRA_NODE_IP_1`, `GCP_INFRA_NODE_IP_2`,
    `GCP_INFRA_MONGODB_URI`, `GCP_INFRA_POSTGRES_URI`, `GCP_INFRA_REDIS_URI` all have
    correct values.

---

## Notes

- Node IPs sorted alphabetically ensure `NODE_IP_1` / `NODE_IP_2` are stable across runs.
- If cluster is re-created, IPs change — run this workflow after every `pulumi up`.
- Passwords are never stored in this file — always fetched live from Bitwarden via MCP.
- Redis URI is internal only; include it in Bitwarden for documentation purposes.
- Item IDs for IP keys are hardcoded (steps 8–10). If those items are deleted and recreated,
  update the IDs accordingly.
