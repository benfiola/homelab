import { Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import {
  BucketSyncPolicy,
  Chart,
  GarageBucket,
  GarageKey,
  getSecurityContext,
  Namespace,
  TcpRoute,
  VaultAuth,
} from "../../cdk8s";
import { TemplateChartFn } from "../../context";

export const chart: TemplateChartFn = async (construct, id) => {
  const chart = new Chart(construct, id, { namespace: id });

  new Namespace(chart);

  const auth = new VaultAuth(chart);

  const key = new GarageKey(chart, "garage", id, auth, {
    accessKeyId: "s3-access-key-id",
    secretAccessKey: "s3-secret-access-key",
  });

  const bucket = new GarageBucket(chart, "garage", id, [key], {
    website: true,
  });

  new BucketSyncPolicy(chart, "minecraft-oigim8", bucket, auth, {
    accessKeyId: "s3-access-key-id",
    secretAccessKey: "s3-secret-access-key",
    gcsCredentials: "google-cloud-credentials-file",
  });

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": "minecraft",
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": "minecraft",
          },
        },
        spec: {
          containers: [
            {
              name: "minecraft",
              image: "itzg/minecraft-server:java25-jdk",
              env: [
                { name: "EULA", value: "true" },
                { name: "VERSION", value: "1.21.11" },
              ],
              ports: [
                {
                  name: "game",
                  containerPort: 25565,
                },
              ],
              securityContext: securityContext.container,
            },
          ],
          securityContext: securityContext.pod,
        },
      },
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "minecraft",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": "minecraft",
      },
      ports: [
        {
          port: 25565,
          name: "game",
        },
      ],
    },
  });

  new TcpRoute(chart, "trusted", "minecraft.bulia.dev", 25565).match(
    service,
    25565,
  );

  new TcpRoute(chart, "public", "minecraft.bfiola.dev", 25565).match(
    service,
    25565,
  );

  return chart;
};
