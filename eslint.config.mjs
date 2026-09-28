import nextConfig from "eslint-config-next/core-web-vitals";

/** ESLint flat config — Next.js 15. `npm run lint` runs this. */
const config = [
  ...nextConfig,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "prisma/migrations/**",
    ],
  },
];

export default config;
