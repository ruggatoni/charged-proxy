// Runs in the app page only (not in proxied pages). Tells the page it's inside
// the Charged Browser and passes along keyboard shortcuts from the main process.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("chargedApp", {
  platform: process.platform,
  onCommand(fn) {
    ipcRenderer.on("charged:cmd", (_event, cmd, arg) => fn(cmd, arg));
  },
});
