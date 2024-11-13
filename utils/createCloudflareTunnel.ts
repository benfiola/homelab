import { Chart } from "cdk8s";
import { createDeployment } from "./createDeployment";
import { createSealedSecret } from "./createSealedSecret";
import { createServiceAccount } from "./createServiceAccount";

interface CloudflareTunnelOpts {
  name: string;
  target: string;
  tunnelUuid: string;
  tunnelToken: string;
}

/**
 * Creates a cloudflare tunnel deployment for the given resource
 */
export const createCloudflareTunnel = async (
  chart: Chart,
  id: string,
  opts: CloudflareTunnelOpts
) => {
  const secret = await createSealedSecret(chart, opts.name, {
    metadata: {
      namespace: chart.namespace,
      name: opts.name,
    },
    stringData: {
      TUNNEL_TOKEN: opts.tunnelToken,
    },
  });

  const serviceAccount = createServiceAccount(chart, `${id}-service-account`, {
    name: opts.name,
    access: {},
  });

  createDeployment(chart, `${id}-deployment`, {
    containers: [
      {
        image: "cloudflare/cloudflared:2024.10.1",
        name: opts.name,
        envFrom: [secret],
        args: [
          "tunnel",
          "--no-autoupdate",
          "run",
          `--url=${opts.target}`,
          opts.tunnelUuid,
        ],
      },
    ],
    name: opts.name,
    serviceAccount: serviceAccount.name,
  });
};
