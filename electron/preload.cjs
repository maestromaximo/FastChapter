const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("fastChapter", {
  createUser: (username) => ipcRenderer.invoke("user:create", username),
  listBooks: (username) => ipcRenderer.invoke("user:listBooks", username),
  getUserProfile: (username) => ipcRenderer.invoke("user:getProfile", username),
  updateUserProfile: (payload) => ipcRenderer.invoke("user:updateProfile", payload),
  testOpenAIKey: (payload) => ipcRenderer.invoke("user:testOpenAIKey", payload),

  createBook: (payload) => ipcRenderer.invoke("book:create", payload),
  renameBook: (payload) => ipcRenderer.invoke("book:rename", payload),
  getBookTree: (payload) => ipcRenderer.invoke("book:getTree", payload),
  createChapter: (payload) => ipcRenderer.invoke("book:createChapter", payload),
  readProjectFile: (payload) => ipcRenderer.invoke("book:readFile", payload),
  writeProjectFile: (payload) => ipcRenderer.invoke("book:writeFile", payload),
  compileLatex: (payload) => ipcRenderer.invoke("book:compileLatex", payload),
  saveRecording: (payload) => ipcRenderer.invoke("book:saveRecording", payload),
  listRecordings: (payload) => ipcRenderer.invoke("book:listRecordings", payload),
  writeMyBook: (payload) => ipcRenderer.invoke("book:writeMyBook", payload)
});
