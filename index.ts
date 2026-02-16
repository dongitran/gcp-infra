import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as k8s from "@pulumi/kubernetes";

const config = new pulumi.Config();
const project = process.env.GCP_PROJECT_ID || config.require("gcp-project");
const region = config.get("gcp-region") || "asia-southeast1";
const zone = config.get("gcp-zone") || "asia-southeast1-a";
const clusterName = config.get("cluster-name") || "gcp-infra";

// VPC Network
const network = new gcp.compute.Network("gcp-infra-network", {
    autoCreateSubnetworks: false,
    project,
});

const subnet = new gcp.compute.Subnetwork("gcp-infra-subnet", {
    ipCidrRange: "10.0.0.0/24",
    region,
    network: network.id,
    project,
    secondaryIpRanges: [
        { rangeName: "pods", ipCidrRange: "10.1.0.0/16" },
        { rangeName: "services", ipCidrRange: "10.2.0.0/20" },
    ],
});

// GKE Cluster
const cluster = new gcp.container.Cluster("gcp-infra-cluster", {
    name: clusterName,
    location: zone,
    project,
    network: network.id,
    subnetwork: subnet.id,

    initialNodeCount: 1,
    removeDefaultNodePool: true,

    ipAllocationPolicy: {
        clusterSecondaryRangeName: "pods",
        servicesSecondaryRangeName: "services",
    },

    addonsConfig: {
        httpLoadBalancing: { disabled: false },
        horizontalPodAutoscaling: { disabled: true },
    },

    releaseChannel: { channel: "STABLE" },

    workloadIdentityConfig: {
        workloadPool: pulumi.interpolate`${project}.svc.id.goog`,
    },

    deletionProtection: false,
});

// Node Pool: 2x e2-medium, 50GB SSD
const nodePool = new gcp.container.NodePool("gcp-infra-nodes", {
    cluster: cluster.name,
    location: zone,
    project,
    nodeCount: 2,

    nodeConfig: {
        machineType: "e2-medium",
        diskSizeGb: 50,
        diskType: "pd-balanced",
        oauthScopes: [
            "https://www.googleapis.com/auth/cloud-platform",
        ],
        workloadMetadataConfig: {
            mode: "GKE_METADATA",
        },

    },

    management: {
        autoRepair: true,
        autoUpgrade: true,
    },
}, {
    deleteBeforeReplace: true,
    replaceOnChanges: ["nodeConfig"],
});

// Build kubeconfig from cluster info
const kubeconfig = pulumi.all([
    cluster.name,
    cluster.endpoint,
    cluster.masterAuth,
    cluster.project,
    cluster.location,
]).apply(([name, endpoint, masterAuth, proj, loc]) => {
    const context = `${proj}_${loc}_${name}`;
    return `apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: ${masterAuth.clusterCaCertificate}
    server: https://${endpoint}
  name: ${context}
contexts:
- context:
    cluster: ${context}
    user: ${context}
  name: ${context}
current-context: ${context}
kind: Config
preferences: {}
users:
- name: ${context}
  user:
    exec:
      apiVersion: client.authentication.k8s.io/v1beta1
      command: gke-gcloud-auth-plugin
      installHint: Install gke-gcloud-auth-plugin for use with kubectl by following
        https://cloud.google.com/kubernetes-engine/docs/how-to/cluster-access-for-kubectl#install_plugin
      provideClusterInfo: true
`;
});

// Kubernetes Provider
const k8sProvider = new k8s.Provider("gke-k8s", {
    kubeconfig,
});

// NGINX Ingress Controller
const ingressNs = new k8s.core.v1.Namespace("ingress-nginx", {
    metadata: { name: "ingress-nginx" },
}, { provider: k8sProvider, dependsOn: [nodePool] });

const nginxIngress = new k8s.helm.v3.Release("ingress-nginx", {
    name: "ingress-nginx",
    chart: "ingress-nginx",
    version: "4.12.0",
    namespace: ingressNs.metadata.name,
    timeout: 600, // 10 minutes timeout
    repositoryOpts: {
        repo: "https://kubernetes.github.io/ingress-nginx",
    },
    values: {
        controller: {
            replicaCount: 1,  // 1 replica - will scale to 2 after ArgoCD deployment
            service: {
                type: "LoadBalancer",
            },
            resources: {
                requests: { cpu: "200m", memory: "256Mi" },
                limits: { cpu: "1000m", memory: "512Mi" },
            },
            // Spread replicas across different nodes for HA
            affinity: {
                podAntiAffinity: {
                    preferredDuringSchedulingIgnoredDuringExecution: [{
                        weight: 100,
                        podAffinityTerm: {
                            labelSelector: {
                                matchExpressions: [{
                                    key: "app.kubernetes.io/name",
                                    operator: "In",
                                    values: ["ingress-nginx"],
                                }],
                            },
                            topologyKey: "kubernetes.io/hostname",
                        },
                    }],
                },
            },
            // Ensure ingress pods are not on the same node
            topologySpreadConstraints: [{
                maxSkew: 1,
                topologyKey: "kubernetes.io/hostname",
                whenUnsatisfiable: "ScheduleAnyway",
                labelSelector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "ingress-nginx",
                        "app.kubernetes.io/component": "controller",
                    },
                },
            }],
        },
    },
}, { provider: k8sProvider, dependsOn: [nodePool] });

// ============================================
// ARGOCD - GitOps Continuous Delivery
// ============================================

// ArgoCD Namespace
const argocdNs = new k8s.core.v1.Namespace("argocd", {
    metadata: {
        name: "argocd",
        labels: {
            "app.kubernetes.io/managed-by": "pulumi",
            "app.kubernetes.io/part-of": "argocd",
        },
    },
}, { provider: k8sProvider, dependsOn: [nodePool] });

// ArgoCD Helm Release - Simplified for 2-node cluster
const argocd = new k8s.helm.v3.Release("argocd", {
    name: "argocd",
    chart: "argo-cd",
    version: "7.7.11", // ArgoCD v2.13.x
    namespace: argocdNs.metadata.name,
    timeout: 600, // 10 minutes timeout
    repositoryOpts: {
        repo: "https://argoproj.github.io/argo-helm",
    },
    values: {
        global: {
            domain: "argocd.local",
        },
        configs: {
            params: {
                "server.insecure": true,
                "server.basehref": "/",
                "server.rootpath": "/",
            },
            cm: {
                "application.instanceLabelKey": "argocd.argoproj.io/instance",
                "admin.enabled": true,
                "users.anonymous.enabled": false,
            },
            rbac: {
                "policy.default": "role:readonly",
                "policy.csv": `p, role:admin, applications, *, */*, allow
g, admin, role:admin`,
            },
            secret: {
                argocdServerAdminPasswordMtime: "1970-01-01T00:00:00Z",
            },
        },
        // Single replica for all components (2-node cluster constraint)
        controller: {
            replicas: 1,
            resources: {
                requests: { cpu: "200m", memory: "256Mi" },
                limits: { cpu: "500m", memory: "512Mi" },
            },
        },
        dex: {
            enabled: false,
        },
        redis: {
            enabled: true,
            resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "100m", memory: "128Mi" },
            },
        },
        server: {
            replicas: 1,
            resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "250m", memory: "256Mi" },
            },
            service: {
                type: "ClusterIP",
            },
            ingress: {
                enabled: false,
            },
        },
        repoServer: {
            replicas: 1,
            resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "250m", memory: "256Mi" },
            },
        },
        applicationSet: {
            enabled: true,
            replicaCount: 1,
            resources: {
                requests: { cpu: "50m", memory: "128Mi" },
                limits: { cpu: "100m", memory: "256Mi" },
            },
        },
        notifications: {
            enabled: false, // Disable to save resources
        },
    },
}, { provider: k8sProvider, dependsOn: [argocdNs, nginxIngress] });

// ArgoCD Ingress - Expose qua NGINX Ingress Controller
const argocdIngress = new k8s.networking.v1.Ingress("argocd-ingress", {
    metadata: {
        name: "argocd-server",
        namespace: argocdNs.metadata.name,
        annotations: {
            "kubernetes.io/ingress.class": "nginx",
            "nginx.ingress.kubernetes.io/force-ssl-redirect": "true",
            "nginx.ingress.kubernetes.io/backend-protocol": "HTTP",
            "nginx.ingress.kubernetes.io/ssl-passthrough": "false",
            // Timeout settings for ArgoCD
            "nginx.ingress.kubernetes.io/proxy-connect-timeout": "300",
            "nginx.ingress.kubernetes.io/proxy-send-timeout": "300",
            "nginx.ingress.kubernetes.io/proxy-read-timeout": "300",
            // WebSocket support (ArgoCD UI uses WebSocket)
            "nginx.ingress.kubernetes.io/proxy-http-version": "1.1",
            "nginx.ingress.kubernetes.io/proxy-buffering": "off",
        },
    },
    spec: {
        ingressClassName: "nginx",
        rules: [{
            host: "argocd.local", // Placeholder - update with real domain
            http: {
                paths: [{
                    path: "/",
                    pathType: "Prefix",
                    backend: {
                        service: {
                            name: "argocd-server",
                            port: { number: 80 },
                        },
                    },
                }],
            },
        }],
    },
}, { provider: k8sProvider, dependsOn: [argocd, nginxIngress] });

// ============================================
// EXPORTS
// ============================================
export const clusterEndpoint = cluster.endpoint;
export const clusterCaCertificate = cluster.masterAuth.apply(
    (auth) => auth.clusterCaCertificate,
);
export const kubeconfigOutput = kubeconfig;
export const clusterNameOutput = cluster.name;
export const networkName = network.name;
export const ingressNginxStatus = nginxIngress.status;

// ArgoCD Exports
export const argocdNamespace = argocdNs.metadata.name;
export const argocdStatus = argocd.status;
export const argocdIngressName = argocdIngress.metadata.name;

// ArgoCD Admin Password (lấy từ Kubernetes Secret)
export const argocdAdminPassword = pulumi
    .all([argocd.status, k8sProvider])
    .apply(async ([status, provider]) => {
        // Chỉ lấy password sau khi ArgoCD đã deploy xong
        if (status && status.name === "argocd") {
            try {
                // Lấy secret từ Kubernetes
                const secret = await k8s.core.v1.Secret.get(
                    "argocd-initial-admin-secret",
                    pulumi.interpolate`${argocdNs.metadata.name}/argocd-initial-admin-secret`,
                    { provider: k8sProvider }
                );
                return secret.data["password"].apply((pwd: string) => 
                    Buffer.from(pwd, "base64").toString("utf-8")
                );
            } catch (e) {
                return "Password not available yet. Retrieve manually with: kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d";
            }
        }
        return "Waiting for ArgoCD deployment...";
    });

// ArgoCD Access Info
export const argocdAccessInfo = pulumi.interpolate`
ArgoCD Deployment Info:
======================
Namespace: ${argocdNs.metadata.name}
Ingress: argocd.local (update DNS or /etc/hosts to point to ingress IP)

Access Methods:
1. Via Ingress (recommended): https://argocd.local
2. Via Port-forward: kubectl port-forward svc/argocd-server -n ${argocdNs.metadata.name} 8080:80

Initial Admin Password:
- Get with: kubectl -n ${argocdNs.metadata.name} get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

CLI Login:
argocd login argocd.local --username admin --password <password>

Web UI:
https://argocd.local (username: admin)
`;    

