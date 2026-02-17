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

// Node Pool: Upgrading to e2-standard-2 (Phase 3/3: Scale up to 2 nodes)
const nodePool = new gcp.container.NodePool("gcp-infra-nodes", {
    cluster: cluster.name,
    location: zone,
    project,
    nodeCount: 2,  // Scaled back to 2 nodes for redundancy

    nodeConfig: {
        machineType: "e2-standard-2",  // Upgraded from e2-medium (4 vCPU vs 2 vCPU)
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
    timeout: 1200, // 20 minutes - give ArgoCD plenty of time to start // 10 minutes timeout
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
// POSTGRESQL DATABASE
// ============================================
// DISABLED: Insufficient CPU resources on e2-medium cluster (requires 500m, only ~110m available)
// See debug_analysis.md for details and solutions
// TODO: Enable when cluster resources are upgraded or reduce CPU request to 250m

// // Create databases namespace
// const dbNamespace = new k8s.core.v1.Namespace("databases", {
//     metadata: { name: "databases" },
// }, { provider: k8sProvider, dependsOn: [nodePool] });
// 
// // Read password from environment (set by GitHub Actions)
// const postgresPassword = process.env.POSTGRES_PASSWORD;
// 
// if (!postgresPassword) {
//     throw new Error("POSTGRES_PASSWORD environment variable is required");
// }
// 
// // Deploy PostgreSQL using Bitnami Helm chart (single master, NodePort)
// const postgresql = new k8s.helm.v3.Release("postgresql", {
//     name: "postgresql",
//     chart: "postgresql",
//     version: "16.5.1",
//     namespace: dbNamespace.metadata.name,
//     repositoryOpts: {
//         repo: "https://charts.bitnami.com/bitnami",
//     },
//     values: {
//         // Single master configuration (no replicas)
//         architecture: "standalone",
// 
//         auth: {
//             database: "app",
//             username: "postgres",
//             password: postgresPassword,
//         },
// 
//         primary: {
//             resources: {
//                 requests: {
//                     cpu: "500m",
//                     memory: "512Mi",
//                 },
//                 limits: {
//                     cpu: "1000m",
//                     memory: "1Gi",
//                 },
//             },
//             persistence: {
//                 enabled: true,
//                 size: "4Gi",
//                 storageClass: "standard-rwo",
//             },
//             service: {
//                 type: "NodePort",  // Use NodePort instead of ClusterIP
//                 nodePorts: {
//                     postgresql: 30432,  // Fixed NodePort for PostgreSQL
//                 },
//             },
//         },
//     },
// }, { provider: k8sProvider, dependsOn: [dbNamespace] });

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

// Stack Reference outputs for other projects
export const clusterLocation = cluster.location;
export const clusterProject = cluster.project;
export const ingressNginxNamespace = ingressNs.metadata.name;
export const ingressNginxServiceName = pulumi.interpolate`${nginxIngress.name}-controller`;

// PostgreSQL outputs (DISABLED - see PostgreSQL deployment section above)
// export const postgresNamespace = dbNamespace.metadata.name;
// export const postgresServiceName = pulumi.interpolate`${postgresql.name}-postgresql`;
// export const postgresNodePort = 30432;
// export const postgresDatabaseName = "app";
// export const postgresUsername = "postgres";


