import { app } from "/tmp/muxi-nitron-runtime/node_modules/nitron/dist/index.js";

app.init({
  name: "暮曦 AI",
  packageId: "com.muxiai.assistant",
  version: "2.0.1",
  entry: "index.html",
  orientation: "portrait",
  statusBar: true,
  permissions: ["INTERNET", "ACCESS_NETWORK_STATE", "RECORD_AUDIO"],
  icon: {
    src: "./assets/icons/icon-512.png",
    background: "#100d18",
  },
});
