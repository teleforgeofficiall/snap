module.exports = {
  apps: [
    {
      name: "snapbucks-bot",
      script: "./node_modules/.bin/tsx",
      args: "server.ts",
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
