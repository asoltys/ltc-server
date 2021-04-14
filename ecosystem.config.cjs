module.exports = {
  apps: [
    {
      name: "ltc-server",
      watch: ["src"],
      script: "index.js",
      env: {
        COMMON_VARIABLE: "true",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
