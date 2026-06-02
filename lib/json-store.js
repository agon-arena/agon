const fs = require("fs");
const path = require("path");

function makeJsonStore(filePath, defaultValue = {}) {
  let cache = null;
  const dir = path.dirname(filePath);

  function ensure() {
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2), "utf8");
    }
  }

  return {
    read() {
      if (cache !== null) return cache;
      ensure();
      try {
        const raw = fs.readFileSync(filePath, "utf8") || JSON.stringify(defaultValue);
        const parsed = JSON.parse(raw);
        cache = Array.isArray(defaultValue) ? (Array.isArray(parsed) ? parsed : defaultValue) : (parsed && typeof parsed === "object" ? parsed : defaultValue);
      } catch {
        cache = Array.isArray(defaultValue) ? [] : {};
      }
      return cache;
    },
    write(data) {
      ensure();
      const safe = Array.isArray(defaultValue) ? (Array.isArray(data) ? data : []) : (data && typeof data === "object" ? data : {});
      fs.writeFileSync(filePath, JSON.stringify(safe, null, 2), "utf8");
      cache = safe;
    },
    invalidate() {
      cache = null;
    }
  };
}

module.exports = { makeJsonStore };
