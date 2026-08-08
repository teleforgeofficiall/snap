module.exports = {
  apps: [
    {
      name: "snapbucks-bot",
      script: "npm",
      args: "run start",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
    },
  ],
};
