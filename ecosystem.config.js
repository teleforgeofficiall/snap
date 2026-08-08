module.exports = {
  apps: [
    {
      name: "snapbucks-bot",
      script: "npx",
      args: "tsx server.ts",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
