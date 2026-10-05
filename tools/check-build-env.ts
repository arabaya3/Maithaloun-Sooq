import { missingProductionVariables } from "./deployment-policy";

const missing = missingProductionVariables(process.env);
if (missing.length) {
  console.error(
    `Production build stopped: missing ${missing.join(", ")}. Set them for the Production environment in Vercel.`,
  );
  process.exit(1);
}
console.log(
  process.env.VERCEL_ENV === "production"
    ? "Production configuration present."
    : `Build environment: ${process.env.VERCEL_ENV ?? "local"}; runtime secrets are not required to build.`,
);
