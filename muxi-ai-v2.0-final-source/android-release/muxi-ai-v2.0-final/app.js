import { app } from "/tmp/muxi-nitron-runtime/node_modules/nitron/dist/index.js";

app.init({
  name: "暮曦 AI",
  packageId: "com.muxiai.assistant",
  version: "muxi-ai-v2.0-final",
  entry: "index.html",
  orientation: "portrait",
  statusBar: true,
  permissions: ["INTERNET", "ACCESS_NETWORK_STATE", "RECORD_AUDIO"],
  icon: {
    src: "./assets/icons/icon-512.png",
    background: "#100d18",
  },
});
