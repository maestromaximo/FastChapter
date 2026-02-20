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
  readProjectMediaDataUrl: (payload) => ipcRenderer.invoke("book:readMediaDataUrl", payload),
  writeProjectFile: (payload) => ipcRenderer.invoke("book:writeFile", payload),
  createProjectFile: (payload) => ipcRenderer.invoke("book:createProjectFile", payload),
  createProjectDirectory: (payload) => ipcRenderer.invoke("book:createProjectDirectory", payload),
  renameProjectEntry: (payload) => ipcRenderer.invoke("book:renameProjectEntry", payload),
  deleteProjectEntry: (payload) => ipcRenderer.invoke("book:deleteProjectEntry", payload),
  writeProjectBinaryFile: (payload) => ipcRenderer.invoke("book:writeBinaryFile", payload),
  moveProjectEntry: (payload) => ipcRenderer.invoke("book:moveProjectEntry", payload),
  compileLatex: (payload) => ipcRenderer.invoke("book:compileLatex", payload),
  saveRecording: (payload) => ipcRenderer.invoke("book:saveRecording", payload),
  listRecordings: (payload) => ipcRenderer.invoke("book:listRecordings", payload),
  getWriteBookChecklist: (payload) => ipcRenderer.invoke("book:getWriteBookChecklist", payload),
  checkCodexAvailability: () => ipcRenderer.invoke("book:checkCodexAvailability"),
  startWriteBookSession: (payload) => ipcRenderer.invoke("book:startWriteBookSession", payload),
  getWriteBookSession: (payload) => ipcRenderer.invoke("book:getWriteBookSession", payload),
  cancelWriteBookSession: (payload) => ipcRenderer.invoke("book:cancelWriteBookSession", payload),
  writeMyBook: (payload) => ipcRenderer.invoke("book:writeMyBook", payload)
});
