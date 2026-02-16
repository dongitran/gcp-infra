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
    timeout: 300, // 5 minutes - skipAwait will handle the rest // 10 minutes timeout
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
// ARGOCD - Minimal deployment for 2-node cluster
// ============================================

// ArgoCD Namespace
const argocdNs = new k8s.core.v1.Namespace("argocd", {
    metadata: {
        name: "argocd",
        labels: {
            "app.kubernetes.io/managed-by": "pulumi",
        },
    },
}, { provider: k8sProvider, dependsOn: [nodePool] });

// ArgoCD Helm Release - Minimal config
const argocd = new k8s.helm.v3.Release("argocd", {
    name: "argocd",
    chart: "argo-cd",
    version: "7.7.11",
    namespace: argocdNs.metadata.name,
    timeout: 600,
    repositoryOpts: {
        repo: "https://argoproj.github.io/argo-helm",
    },
    values: {
        configs: {
            params: {
                "server.insecure": true,
            },
            cm: {
                "admin.enabled": true,
                "users.anonymous.enabled": false,
            },
            secret: {
                argocdServerAdminPasswordMtime: "1970-01-01T00:00:00Z",
            },
        },
        // Minimal resources for 2-node cluster
        controller: {
            replicas: 1,
            resources: {
                requests: { cpu: "100m", memory: "128Mi" },
                limits: { cpu: "300m", memory: "256Mi" },
            },
        },
        dex: {
            enabled: false,
        },
        redis: {
            enabled: true,
            resources: {
                requests: { cpu: "50m", memory: "32Mi" },
                limits: { cpu: "100m", memory: "64Mi" },
            },
        },
        server: {
            replicas: 1,
            resources: {
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "200m", memory: "128Mi" },
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
                requests: { cpu: "50m", memory: "64Mi" },
                limits: { cpu: "200m", memory: "128Mi" },
            },
        },
        applicationSet: {
            enabled: false, // Disable to save resources
        },
        notifications: {
            enabled: false,
        },
    },
}, { 
    provider: k8sProvider, 
    dependsOn: [argocdNs, nginxIngress],
    skipAwait: true, // Don't wait for pods to be ready (avoid timeout)
});

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

// ArgoCD Access Instructions
export const argocdAccessInfo = pulumi.interpolate`
ArgoCD Access Information:
=========================
Namespace: ${argocdNs.metadata.name}

Access via Port-forward:
  kubectl port-forward svc/argocd-server -n ${argocdNs.metadata.name} 8080:80

Then open: http://localhost:8080

Get admin password:
  kubectl -n ${argocdNs.metadata.name} get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d

Login:
  Username: admin
  Password: (see command above)
`;        

