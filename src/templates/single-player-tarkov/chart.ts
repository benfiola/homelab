import * as zod from "zod";
import { EnvVar, Service, StatefulSet } from "../../../assets/kubernetes/k8s";
import { Chart, getSecurityContext, Namespace, TcpRoute } from "../../cdk8s";
import { TemplateChartFn } from "../../context";
import { gameServerImage } from "../../game-server-images";

const optsSchema = zod.object({
  subdomain: zod.string().default("spt"),
  port: zod.int().default(6969),
  mods: zod.array(zod.string()).default([]),
  version: zod.string().optional(),
});

export const chart: TemplateChartFn = async (construct, id, context) => {
  const chart = new Chart(construct, id, { namespace: id });
  const opts = await optsSchema.parseAsync(context.opts);

  new Namespace(chart);

  const securityContext = getSecurityContext({ uid: 1000, gid: 1000 });

  const env: EnvVar[] = [];
  if (opts.version) {
    env.push({ name: "VERSION", value: opts.version });
  }

  new StatefulSet(chart, `${id}-stateful-set`, {
    metadata: {
      name: "single-player-tarkov",
    },
    spec: {
      selector: {
        matchLabels: {
          "app.kubernetes.io/name": id,
        },
      },
      template: {
        metadata: {
          labels: {
            "app.kubernetes.io/name": id,
          },
        },
        spec: {
          containers: [
            {
              name: "single-player-tarkov",
              image: gameServerImage("single-player-tarkov"),
              ports: [
                {
                  name: "tcp",
                  containerPort: 6969,
                },
              ],
              securityContext: securityContext.container,
              volumeMounts: [{ name: "cache", mountPath: "/cache" }],
              env: [...env, { name: "LOG_LEVEL", value: "debug" }],
            },
          ],
          securityContext: securityContext.pod,
        },
      },
      volumeClaimTemplates: [
        {
          metadata: {
            name: "cache",
          },
          spec: {
            accessModes: ["ReadWriteOnce"],
            resources: {
              requests: {
                storage: "10Gi",
              },
            },
            storageClassName: "replicated",
          },
        } as any,
      ],
    },
  });

  const service = new Service(chart, `${id}-service`, {
    metadata: {
      name: "single-player-tarkov",
    },
    spec: {
      selector: {
        "app.kubernetes.io/name": id,
      },
      ports: [
        {
          port: 6969,
          name: "tcp",
        },
      ],
    },
  });

  const url = `${opts.subdomain}.bulia.dev`;
  new TcpRoute(chart, "trusted", url, [opts.port]).match(service, 6969);

  return chart;
};
