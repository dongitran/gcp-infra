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

// Firewall Rule: Allow Database NodePort access
const databaseFirewall = new gcp.compute.Firewall("allow-database-nodeports", {
    network: network.id,
    project,
    allows: [
        {
            protocol: "tcp",
            ports: ["30432"],  // PostgreSQL only (Redis/MongoDB use ClusterIP)
        },
    ],
    sourceRanges: ["0.0.0.0/0"], // Allow from anywhere (restrict in production)
    targetTags: [], // Apply to all instances in the network
    description: "Allow external access to database NodePorts: PostgreSQL:30432",
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
// Deployed after cluster upgrade to e2-standard-2 (8 vCPU total, ~7600m allocatable)
// PostgreSQL requires 500m CPU, which is now available

// Create databases namespace
const dbNamespace = new k8s.core.v1.Namespace("databases", {
    metadata: { name: "databases" },
}, { provider: k8sProvider, dependsOn: [nodePool] });

// Read password from environment (set by GitHub Actions)
const postgresPassword = process.env.POSTGRES_PASSWORD;

if (!postgresPassword) {
    throw new Error("POSTGRES_PASSWORD environment variable is required");
}

// Deploy PostgreSQL using CloudPirates Helm chart (standalone, NodePort)
// Migrated from Bitnami (discontinued by Broadcom Aug 2025) to CloudPirates (open-source)
// Uses official Docker postgres image instead of Bitnami custom image
const postgresql = new k8s.helm.v3.Release("postgresql", {
    name: "postgresql",
    chart: "oci://registry-1.docker.io/cloudpirates/postgres",
    namespace: dbNamespace.metadata.name,
    values: {
        auth: {
            database: "app",
            username: "postgres",
            password: postgresPassword,
        },

        resources: {
            requests: {
                cpu: "500m",
                memory: "512Mi",
            },
            limits: {
                cpu: "1000m",
                memory: "1Gi",
            },
        },

        persistence: {
            enabled: true,
            size: "4Gi",
            storageClass: "standard-rwo",
        },

        service: {
            type: "NodePort",
            nodePort: 30432,  // Fixed NodePort for PostgreSQL
        },
    },
}, { provider: k8sProvider, dependsOn: [dbNamespace] });

// ============================================
// REDIS CACHE
// ============================================
// Deploy Redis for caching and session storage
// ClusterIP only — access externally via kubectl port-forward

// Read password from environment (set by GitHub Actions)
const redisPassword = process.env.REDIS_PASSWORD;

if (!redisPassword) {
    throw new Error("REDIS_PASSWORD environment variable is required");
}

// Deploy Redis using CloudPirates Helm chart (standalone, ClusterIP)
// Migrated from Bitnami (discontinued by Broadcom Aug 2025) to CloudPirates
const redis = new k8s.helm.v3.Release("redis", {
    name: "redis",
    chart: "oci://registry-1.docker.io/cloudpirates/redis",
    namespace: dbNamespace.metadata.name,
    values: {
        architecture: "standalone",

        auth: {
            enabled: true,
            password: redisPassword,
        },

        resources: {
            requests: {
                cpu: "250m",
                memory: "256Mi",
            },
            limits: {
                cpu: "500m",
                memory: "512Mi",
            },
        },

        persistence: {
            enabled: true,
            size: "2Gi",
            storageClass: "standard-rwo",
        },

        service: {
            type: "ClusterIP",
        },
    },
}, { provider: k8sProvider, dependsOn: [dbNamespace] });

// ============================================
// MONGODB DATABASE
// ============================================
// Deploy MongoDB for document storage
// ClusterIP only — access externally via kubectl port-forward

// Read password from environment (set by GitHub Actions)
const mongodbPassword = process.env.MONGODB_PASSWORD;

if (!mongodbPassword) {
    throw new Error("MONGODB_PASSWORD environment variable is required");
}

// Deploy MongoDB using CloudPirates Helm chart (standalone, ClusterIP)
// Migrated from Bitnami (discontinued by Broadcom Aug 2025) to CloudPirates
// Uses root auth only — create app users manually if needed
const mongodb = new k8s.helm.v3.Release("mongodb", {
    name: "mongodb",
    chart: "oci://registry-1.docker.io/cloudpirates/mongodb",
    namespace: dbNamespace.metadata.name,
    values: {
        auth: {
            enabled: true,
            rootPassword: mongodbPassword,
        },

        resources: {
            requests: {
                cpu: "500m",
                memory: "512Mi",
            },
            limits: {
                cpu: "1000m",
                memory: "1Gi",
            },
        },

        persistence: {
            enabled: true,
            size: "4Gi",
            storageClass: "standard-rwo",
        },

        service: {
            type: "ClusterIP",
        },
    },
}, { provider: k8sProvider, dependsOn: [dbNamespace] });



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


